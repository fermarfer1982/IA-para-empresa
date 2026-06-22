import { createVoiceGetHandler } from "../../../lib/voiceApiHandler";
import { searchVoice } from "../../../lib/voiceSemantic";

export default createVoiceGetHandler((req) => searchVoice(req.query?.q || ""));
