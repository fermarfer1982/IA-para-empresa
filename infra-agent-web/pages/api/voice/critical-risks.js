import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getCriticalRisksVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getCriticalRisksVoice());
