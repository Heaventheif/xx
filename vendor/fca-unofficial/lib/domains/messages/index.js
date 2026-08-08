import * as send_message_1 from "./commands/send-message.js";
import * as mark_read_1 from "./commands/mark-read.js";
import * as send_typing_indicator_1 from "./commands/send-typing-indicator.js";
import * as mark_seen_1 from "./commands/mark-seen.js";
import * as mark_delivered_1 from "./commands/mark-delivered.js";
import * as mark_read_all_1 from "./commands/mark-read-all.js";
import * as set_message_reaction_1 from "./commands/set-message-reaction.js";
import * as share_contact_1 from "./commands/share-contact.js";
import * as edit_message_1 from "./commands/edit-message.js";
import * as delete_message_1 from "./commands/delete-message.js";
import * as unsend_message_1 from "./commands/unsend-message.js";
import * as forward_attachment_1 from "./commands/forward-attachment.js";
import * as upload_attachment_1 from "./commands/upload-attachment.js";
import * as change_thread_color_1 from "./commands/change-thread-color.js";
import * as change_thread_emoji_1 from "./commands/change-thread-emoji.js";
import * as pin_message_1 from "./commands/pin-message.js";
import * as share_link_1 from "./commands/share-link.js";
import * as get_emoji_url_1 from "./queries/get-emoji-url.js";
import * as get_thread_colors_1 from "./queries/get-thread-colors.js";
import * as resolve_photo_url_1 from "./queries/resolve-photo-url.js";
import * as get_message_1 from "./queries/get-message.js";
function compactNamespace(namespace) {
  return Object.fromEntries(Object.entries(namespace).filter(([, value]) => value !== undefined));
}
export function createMessagesDomain(deps) {
  return compactNamespace({
    send: (0, send_message_1.createSendMessageCommand)(deps.send),
    markRead: (0, mark_read_1.createMarkReadCommand)(deps.markRead),
    typing: (0, send_typing_indicator_1.createSendTypingIndicatorCommand)(deps.typing),
    markSeen: deps.markSeen ? (0, mark_seen_1.createMarkSeenCommand)(deps.markSeen) : undefined,
    markDelivered: deps.markDelivered ? (0, mark_delivered_1.createMarkDeliveredCommand)(deps.markDelivered) : undefined,
    markReadAll: deps.markReadAll ? (0, mark_read_all_1.createMarkReadAllCommand)(deps.markReadAll) : undefined,
    react: (0, set_message_reaction_1.createSetMessageReactionCommand)(deps.reaction),
    uploadAttachment: deps.uploadAttachment ? (0, upload_attachment_1.createUploadAttachmentCommand)(deps.uploadAttachment) : undefined,
    edit: deps.edit ? (0, edit_message_1.createEditMessageCommand)(deps.edit) : undefined,
    delete: deps.delete ? (0, delete_message_1.createDeleteMessageCommand)(deps.delete) : undefined,
    unsend: deps.unsend ? (0, unsend_message_1.createUnsendMessageCommand)(deps.unsend) : undefined,
    forwardAttachment: deps.forwardAttachment ? (0, forward_attachment_1.createForwardAttachmentCommand)(deps.forwardAttachment) : undefined,
    shareContact: deps.shareContact ? (0, share_contact_1.createShareContactCommand)(deps.shareContact) : undefined,
    shareLink: deps.shareLink ? (0, share_link_1.createShareLinkCommand)(deps.shareLink) : undefined,
    pin: deps.pin ? (0, pin_message_1.createPinMessageCommand)(deps.pin) : undefined,
    setThreadColor: (0, change_thread_color_1.createChangeThreadColorCommand)(deps.threadColor),
    setThreadEmoji: (0, change_thread_emoji_1.createChangeThreadEmojiCommand)(deps.threadEmoji),
    get: deps.get ? (0, get_message_1.createGetMessageQuery)(deps.get) : undefined,
    getEmojiUrl: (0, get_emoji_url_1.createGetEmojiUrlQuery)(),
    getThreadColors: (0, get_thread_colors_1.createGetThreadColorsQuery)(),
    resolvePhotoUrl: deps.photoUrl ? (0, resolve_photo_url_1.createResolvePhotoUrlQuery)(deps.photoUrl) : undefined
  });
}
export * from "./message.types.js";
export * from "./commands/send-message.js";
export * from "./commands/mark-read.js";
export * from "./commands/send-typing-indicator.js";
export * from "./commands/mark-seen.js";
export * from "./commands/mark-delivered.js";
export * from "./commands/mark-read-all.js";
export * from "./commands/set-message-reaction.js";
export * from "./commands/upload-attachment.js";
export * from "./commands/edit-message.js";
export * from "./commands/delete-message.js";
export * from "./commands/unsend-message.js";
export * from "./commands/forward-attachment.js";
export * from "./commands/share-contact.js";
export * from "./commands/share-link.js";
export * from "./commands/pin-message.js";
export * from "./commands/change-thread-color.js";
export * from "./commands/change-thread-emoji.js";
export * from "./queries/get-message.js";
export * from "./queries/get-emoji-url.js";
export * from "./queries/get-thread-colors.js";
export * from "./queries/resolve-photo-url.js";
export default {
  createMessagesDomain
};