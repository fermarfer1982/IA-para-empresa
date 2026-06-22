import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getStorageBackupStatusVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getStorageBackupStatusVoice());
