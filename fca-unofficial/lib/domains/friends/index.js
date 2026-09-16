// friends/index.js — Consolidated friend-management domain
// Covers: requests, accept, list, suggestions, send friend request.
import * as httpFb from '../../transport/http/facebook.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise friend data from different GraphQL shapes into a unified object.
 * @private
 */
function formatFriendEdges(edges) {
  if (!Array.isArray(edges)) return [];
  return edges.map((edge) => {
    const node = edge.node || edge;
    return {
      userID: node.id || node.node?.id || null,
      name: node.name || node.title?.text || null,
      profilePicture: node.profile_picture?.uri || node.image?.uri || null,
      socialContext: node.social_context?.text || node.subtitle_text?.text || null,
      url: node.url || null,
    };
  });
}

/**
 * Pick the edge array from a raw GraphQL response depending on query type.
 * @private
 */
function extractEdges(data, type) {
  const viewer = data?.data?.viewer;
  switch (type) {
    case 'requests':
      return viewer?.friend_requests?.edges ?? [];
    case 'suggestions':
      return viewer?.people_you_may_know?.edges ?? [];
    case 'list':
      return (
        data?.data?.node?.all_collections?.nodes?.[0]?.style_renderer?.collection?.pageItems
          ?.edges ?? []
      );
    default:
      return [];
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates the friends domain.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {FriendsDomain}
 */
export function createFriendsDomain(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  /** @param {object} form */
  function graphql(form) {
    return httpFb
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/api/graphql/',
        form: {
          av: ctx.userID,
          __user: ctx.userID,
          __a: '1',
          fb_dtsg: ctx.fb_dtsg,
          jazoest: ctx.jazoest,
          lsd: ctx.lsd,
          fb_api_caller_class: 'RelayModern',
          ...form,
        },
      })
      .then((res) => {
        if (res?.data?.errors) throw new Error(JSON.stringify(res.data.errors));
        return res;
      });
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Fetch incoming friend requests. */
  async function requests() {
    const res = await graphql({
      fb_api_req_friendly_name: 'FriendingCometRootContentQuery',
      variables: JSON.stringify({ scale: 3 }),
      doc_id: '9103543533085580',
    });
    return formatFriendEdges(extractEdges(res.data, 'requests'));
  }

  /**
   * Accept a friend request.
   * @param {string} identifier — userID (numeric string) or partial name to search within pending requests.
   */
  async function accept(identifier) {
    if (!identifier) throw new Error('friends.accept: A name or userID is required.');

    let targetUserID = identifier;

    // If it's not a numeric ID, find the user in pending requests by name
    if (isNaN(identifier)) {
      const pending = await requests();
      const found = pending.find((r) => r.name?.toLowerCase().includes(identifier.toLowerCase()));
      if (!found) throw new Error(`friends.accept: No friend request matching "${identifier}".`);
      targetUserID = found.userID;
    }

    const res = await graphql({
      fb_api_req_friendly_name: 'FriendingCometFriendRequestConfirmMutation',
      variables: JSON.stringify({
        input: {
          friend_requester_id: targetUserID,
          friending_channel: 'FRIENDS_HOME_MAIN',
          actor_id: ctx.userID,
          client_mutation_id: String(Math.floor(Math.random() * 10 + 1)),
        },
        scale: 3,
      }),
      doc_id: '24630768433181357',
    });

    // Handle a known error code
    const errStr = JSON.stringify(res);
    if (errStr.includes('1431004')) {
      throw new Error(
        'friends.accept: Cannot accept this request right now. Try again later or check the account.',
      );
    }

    return res?.data?.data ?? res;
  }

  /**
   * Decline a friend request.
   * @param {string} userID
   */
  async function decline(userID) {
    if (!userID) throw new Error('friends.decline: userID is required.');
    const res = await graphql({
      fb_api_req_friendly_name: 'FriendingCometFriendRequestDeleteMutation',
      variables: JSON.stringify({
        input: {
          friend_requester_id: String(userID),
          actor_id: ctx.userID,
          client_mutation_id: String(Math.floor(Math.random() * 10 + 1)),
        },
        scale: 3,
      }),
      doc_id: '5574260925973988',
    });
    return res?.data?.data ?? res;
  }

  /**
   * Fetch the friend list for a user (defaults to logged-in user).
   * @param {string} [userID]
   */
  async function list(userID = ctx.userID) {
    const sectionToken = Buffer.from(`app_section:${userID}:2356318349`).toString('base64');
    const res = await graphql({
      fb_api_req_friendly_name: 'ProfileCometTopAppSectionQuery',
      variables: JSON.stringify({
        collectionToken: null,
        scale: 2,
        sectionToken,
        useDefaultActor: false,
        userID,
      }),
      doc_id: '24492266383698794',
    });
    return formatFriendEdges(extractEdges(res.data, 'list'));
  }

  // ── Suggestions sub-namespace ──────────────────────────────────

  /**
   * Fetch "People You May Know" suggestions.
   * @param {number} [limit=30]
   */
  async function suggestList(limit = 30) {
    const res = await graphql({
      fb_api_req_friendly_name: 'FriendingCometPYMKPanelPaginationQuery',
      variables: JSON.stringify({ count: limit, cursor: null, scale: 3 }),
      doc_id: '9917809191634193',
    });
    return formatFriendEdges(extractEdges(res.data, 'suggestions'));
  }

  /**
   * Send a friend request to a user.
   * @param {string} userID
   */
  async function suggestRequest(userID) {
    if (!userID) throw new Error('friends.suggest.request: userID is required.');
    const res = await graphql({
      fb_api_req_friendly_name: 'FriendingCometFriendRequestSendMutation',
      variables: JSON.stringify({
        input: {
          friend_requestee_ids: [String(userID)],
          friending_channel: 'FRIENDS_HOME_MAIN',
          actor_id: ctx.userID,
          client_mutation_id: String(Math.floor(Math.random() * 10 + 1)),
        },
        scale: 3,
      }),
      doc_id: '23982103144788355',
    });
    return res?.data?.data ?? res;
  }

  // ── Exported domain object ─────────────────────────────────────

  return {
    requests,
    accept,
    decline,
    list,
    suggest: {
      list: suggestList,
      request: suggestRequest,
    },
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-friends-index',
  meta: { category: 'domain-friends', path: 'lib/domains/friends/index.js' },
  setup(_ctx) {
    // provides: createFriendsDomain
  },
};
