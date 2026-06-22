import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { getLatestMatrixVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler(() => getLatestMatrixVoice());
