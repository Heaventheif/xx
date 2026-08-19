"use strict";

// Emoji pairs used to let a user react to pick an item from a numbered list
// (one pair per list position: first emoji = primary choice, second = alt choice).
export const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🤩", "😘"], ["😍", "😭"],
  ["🤔", "😅"], ["😁", "🥹"], ["🥸", "😎"], ["🙂", "😇"],
];

// Register a reaction listener on a just-sent "list" message so the user can
// react with one of EMOJI_PAIRS to pick an item. `onPick(item, altChosen)` is
// called with the selected list entry and whether the alt emoji was used.
// The listener auto-expires after `ttlMs` (default 2 minutes).
export function attachReactionPicker({ sentMessageID, authorID, list, onPick, ttlMs = 120000 }) {
  if (!sentMessageID || !global.client?.reactionListener) return;

  const cleanup = () => {
    delete global.client.reactionListener[sentMessageID];
    if (global.Kagenou?.replies) delete global.Kagenou.replies[sentMessageID];
  };

  global.client.reactionListener[sentMessageID] = {
    author: authorID,
    callback: async ({ event: reactionEvent }) => {
      const reaction = reactionEvent.reaction;
      const idx = EMOJI_PAIRS.findIndex(([primary, alt]) => reaction === primary || reaction === alt);
      if (idx < 0 || idx >= list.length) return;

      const altChosen = reaction === EMOJI_PAIRS[idx][1];
      cleanup();
      await onPick(list[idx], altChosen);
    },
  };

  setTimeout(cleanup, ttlMs);
}

// Build the numbered search-results list text shown before picking.
export function buildListText(results, wantMp4) {
  let text = `${wantMp4 ? "🎬" : "🎵"} نتائج البحث:\n${"─".repeat(22)}\n`;
  results.forEach((v, i) => {
    const [mp3E, mp4E] = EMOJI_PAIRS[i];
    text +=
      `${i + 1}. ${v.title}\n` +
      `   ⏱ ${v.duration || "--"}${v.uploader ? `  📺 ${v.uploader}` : ""}\n` +
      `   ${mp3E} mp3  |  ${mp4E} mp4\n` +
      `${"─".repeat(22)}\n`;
  });
  text += `تفاعل بالإيموجي لاختيار الأغنية\n⏳ تنتهي بعد دقيقتين`;
  return text;
}
