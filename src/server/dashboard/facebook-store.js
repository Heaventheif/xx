"use strict";
/**
 * In-memory store for Facebook account events (stories, friend requests, etc.)
 * Cleared on bot restart — persists within the same session
 */

const MAX_STORY_EVENTS = 100;

// Initialize global stores
if (!global._storyEvents)      global._storyEvents      = [];
if (!global._fbFriendEvents)   global._fbFriendEvents   = [];
if (!global._fbStoryWatchList) global._fbStoryWatchList = new Set();

/**
 * Record a story event detected via MQTT or polling
 * @param {object} event - story event data
 */
export function recordStoryEvent(event) {
  const entry = {
    id:        event.storyID || event.postID || `story_${Date.now()}`,
    senderID:  event.senderID || event.authorID || null,
    senderName:event.senderName || null,
    preview:   event.preview || event.body || null,
    timestamp: event.timestamp || Date.now(),
    type:      event.type || "story",
    raw:       event,
  };
  // Dedup by id
  const exists = global._storyEvents.some(s => s.id === entry.id);
  if (!exists) {
    global._storyEvents.unshift(entry);
    if (global._storyEvents.length > MAX_STORY_EVENTS) {
      global._storyEvents.pop();
    }
  }
}

/**
 * Record a friend-related event (friend request received, accepted, etc.)
 * @param {object} event
 */
export function recordFriendEvent(event) {
  const entry = {
    senderID:   event.senderID || null,
    senderName: event.senderName || null,
    type:       event.type || "friend_event",
    timestamp:  event.timestamp || Date.now(),
  };
  global._fbFriendEvents.unshift(entry);
  if (global._fbFriendEvents.length > 50) global._fbFriendEvents.pop();
}

export function getStoryEvents()  { return global._storyEvents; }
export function getFriendEvents() { return global._fbFriendEvents; }
export function clearStoryEvents(){ global._storyEvents = []; }
