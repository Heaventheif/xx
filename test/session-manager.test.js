// Compatibility entry point: the original uploaded filename ended in
// `.test_.js`, which Node/Bun test discovery does not include.
import "./session-manager.test_.js";