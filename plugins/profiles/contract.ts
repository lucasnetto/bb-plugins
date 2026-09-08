import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const profileSchema = z.enum(["personal", "work"]);
export type Profile = z.infer<typeof profileSchema>;
export const profileInfoSchema = z.object({
  current: profileSchema,
  profiles: z.array(z.object({
    id: profileSchema,
    name: z.string(),
    email: z.string(),
    url: z.string().url(),
    localUrl: z.string().url(),
  }).strict()),
}).strict();
export type ProfileInfo = z.infer<typeof profileInfoSchema>;
export const rpcContract = defineRpcContract({
  info: { input: z.null(), output: profileInfoSchema },
});
