import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getOpenIncidentsVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getOpenIncidentsVoice());
