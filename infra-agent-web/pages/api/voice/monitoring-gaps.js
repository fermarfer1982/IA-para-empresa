import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getMonitoringGapsVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getMonitoringGapsVoice());
