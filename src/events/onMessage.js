"use strict";
import { handleMessage, handleEvent, handleReaction, invalidateThreadInfoCache } from "../core/Router.js";
import { recordStoryEvent, recordFriendEvent } from "../server/dashboard/facebook-store.js";

/**
 * Detect and capture story events from MQTT stream
 * FCA passes through raw events — stories may appear with certain types or attachment structures
 * @param {object} event - raw MQTT event
 */
function detectStoryEvent(event) {
  // Check event type for story-like events
  const storyTypes = ["story_reaction", "story_reply", "story_mention"];
  if (storyTypes.includes(event.type)) {
    recordStoryEvent({
      storyID:   event.storyID || event.threadID || null,
      senderID:  event.senderID || event.actorID || null,
      senderName:event.senderName || null,
      preview:   event.body || event.reactionType || null,
      timestamp: event.timestamp || Date.now(),
      type:      event.type,
    });
    return;
  }

  // Check attachments for story-related content
  if (Array.isArray(event.attachments)) {
    for (const att of event.attachments) {
      const attType = att?.type || att?.mimeType || "";
      if (
        attType.toLowerCase().includes("story") ||
        att?.url?.includes("/stories/") ||
        att?.storyID
      ) {
        recordStoryEvent({
          storyID:    att.storyID || att.attachmentID || null,
          senderID:   event.senderID || null,
          senderName: null,
          preview:    att.title || att.description || att.url || null,
          timestamp:  event.timestamp || Date.now(),
          type:       "story_attachment",
        });
        break;
      }
    }
  }

  // Log:story — Facebook sometimes sends story events as log events
  if (event.type === "log" && event.logMessageType?.includes("story")) {
    recordStoryEvent({
      storyID:   event.messageID || null,
      senderID:  event.author || event.senderID || null,
      senderName:null,
      preview:   event.logMessageBody || null,
      timestamp: event.timestamp || Date.now(),
      type:      "log_story",
    });
  }
}

/**
 * Detect friend-related events from MQTT
 * @param {object} event - raw MQTT event
 */
function detectFriendEvent(event) {
  const friendEventTypes = ["friend_request", "friend_add", "friend_confirmed", "friendship"];
  if (friendEventTypes.includes(event.type)) {
    recordFriendEvent({
      senderID:   event.senderID || event.actorID || null,
      senderName: event.senderName || null,
      type:       event.type,
      timestamp:  event.timestamp || Date.now(),
    });
  }
}

export function dispatchMqttEvent(api, event, label, acceptedThreads) {
  if (global.isBanned(event.threadID, event.senderID ?? event.userID)) return;

  // Auto-accept message requests from unknown threads
  if (
    event.threadID &&
    ["message", "message_reply"].includes(event.type) &&
    !acceptedThreads.has(event.threadID) &&
    typeof api.handleMessageRequest === "function"
  ) {
    acceptedThreads.add(event.threadID);
    api.handleMessageRequest([event.threadID], true, (err) => {
      if (err) {
        acceptedThreads.delete(event.threadID);
      }
    });
  }

  // [FIX ADMIN CACHE] إبطال cache المجموعة فوراً عند تغيير المشرفين
  if (event.logMessageType === "change_thread_admins" && event.threadID) {
    invalidateThreadInfoCache(event.threadID);
  }

  // [FIX CACHE EVICT] Invalidate thread cache when the bot itself is removed
  // from a group — otherwise stale data lingers for up to 5 min and causes
  // confusing "not an admin" errors if the bot rejoins the same group.
  if (
    event.logMessageType === "remove_from_group" &&
    event.threadID &&
    event.participantIDs?.some(id => String(id) === String(api.getCurrentUserID?.()))
  ) {
    invalidateThreadInfoCache(event.threadID);
    console.log(`[CACHE] 🗑️ Bot أُخرج من المجموعة ${event.threadID} — cache مُبطَل.`);
  }

  // Detect and store story/friend events for the dashboard
  detectStoryEvent(event);
  detectFriendEvent(event);

  if (["message", "message_reply", "log", "event"].includes(event.type)) {
    // تمييز الرسالة كمقروءة — نؤخّره 800ms لضمان أن mqttClient جاهز بعد listenMqtt
    if (["message", "message_reply"].includes(event.type) && event.threadID) {
      setTimeout(() => {
        try {
          if (typeof api.markAsRead === "function") {
            api.markAsRead(event.threadID, true, (err) => {
              if (err) console.warn(`[MARK-READ:${label}]`, err.message || err);
            });
          }
        } catch (e) {
          console.warn(`[MARK-READ:${label}]`, e.message);
        }
      }, 800);
    }
    handleEvent(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
    handleMessage(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
  } else if (event.type === "message_reaction") {
    handleReaction(api, event);
  }
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-events-on-message',
  meta: { category: 'event', path: 'src/events/onMessage.js' },
  setup(_ctx) {
    // provides: dispatchMqttEvent
  },
};
