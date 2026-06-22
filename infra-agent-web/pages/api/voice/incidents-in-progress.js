import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getIncidentsInProgressVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getIncidentsInProgressVoice());
