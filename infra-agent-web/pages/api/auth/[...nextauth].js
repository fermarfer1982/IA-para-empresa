import NextAuth from "next-auth";
import { authOptions } from "../../../lib/security/authOptions";

export default NextAuth(authOptions);
