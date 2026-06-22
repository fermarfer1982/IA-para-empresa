import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getMorningBriefingVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getMorningBriefingVoice());
