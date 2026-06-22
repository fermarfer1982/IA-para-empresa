import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getTodayActionsVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getTodayActionsVoice());
