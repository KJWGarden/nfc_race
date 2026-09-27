import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8);
const short = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);
const tiny = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 4);

export const createId = () => nanoid();
export const createSessionCode = () => short();
export const createTeamCode = () => tiny();
export const createTagToken = () => customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10)();
