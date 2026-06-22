import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getTodayReportVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getTodayReportVoice());
