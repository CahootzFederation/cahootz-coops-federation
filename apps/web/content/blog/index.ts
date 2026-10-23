import type { BlogPost } from "../../lib/blog";
import { cahootzHandbook } from "./cahootz-handbook";

// Editorial posts are reviewed in PRs and never written by the Notion sync.
export const pullRequestPosts: BlogPost[] = [cahootzHandbook];
