// get-user-id.js — Look up a user ID by name/username or extract from profile URL
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as httpFb from '../../../transport/http/facebook.js';
import * as shared from '../shared.js';

/**
 * Creates the getUserID query.
 *
 * Behaviour:
 *  - If `link` looks like a profile URL (contains ".com"), extract the UID directly
 *    or scrape the page for it.
 *  - Otherwise treat it as a name/username and run a typeahead search.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(link: string, callback?: Function) => Promise<string | Array>}
 */
export function createGetUserIdQuery(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  return function getUserID(link, callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, []);

    if (!link || typeof link !== 'string') {
      const err = new Error('getUserID: link parameter must be a non-empty string');
      logError?.('getUserID', err);
      cb(err);
      return promise;
    }

    const isProfileUrl = /\.com/.test(link);

    if (!isProfileUrl) {
      // Name / username → typeahead search
      httpFb
        .getWithLoginCheck({
          defaultFuncs,
          ctx,
          url: 'https://www.facebook.com/ajax/typeahead/search.php',
          form: {
            value: link.toLowerCase(),
            viewer: ctx.userID,
            rsp: 'search',
            context: 'search',
            path: '/home.php',
            request_id: ctx.clientId,
          },
        })
        .then((res) => {
          if (res.error) throw res;
          const entries = res?.payload?.entries;
          if (!entries) {
            throw new Error(
              'getUserID: No results found. The account may require verification.',
            );
          }
          cb(null, entries.map(shared.formatUserIdEntry));
        })
        .catch((err) => {
          logError?.('getUserID', err);
          cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
        });

      return promise;
    }

    // Profile URL path
    let uid;
    if (link.includes('profile.php?id=')) {
      uid = link.split('profile.php?id=')[1].split('&')[0];
      if (uid && /^\d+$/.test(uid)) {
        cb(null, uid);
        return promise;
      }
    }

    // Fetch the page and scrape the userID
    httpFb
      .getWithLoginCheck({ defaultFuncs, ctx, url: link })
      .then((html) => {
        if (typeof html !== 'string') throw new Error('getUserID: unexpected non-string response');
        const match =
          html.match(/"userID":"(\d+)"/) ||
          html.match(/"id":"(\d+)"/) ||
          html.match(/entity_id["\s:]+(\d+)/);
        if (!match) throw new Error('getUserID: could not extract user ID from profile URL');
        cb(null, match[1]);
      })
      .catch((err) => {
        logError?.('getUserID', err);
        cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      });

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-users-queries-get-user-id',
  meta: { category: 'domain-users', path: 'lib/domains/users/queries/get-user-id.js' },
  setup(_ctx) {
    // provides: createGetUserIdQuery
  },
};
