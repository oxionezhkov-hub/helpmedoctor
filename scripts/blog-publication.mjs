import { ARTICLES } from "./site/articles.mjs";
import { markPublished, moscowDay, prepareRelease, readArticle } from "./site/publication.mjs";

const [action, dir, arg] = process.argv.slice(2);
if (!dir || !["prepare", "mark", "validate"].includes(action) || (action !== "mark" && !arg)) {
  throw new Error("Использование: blog-publication.mjs prepare <state> <queue> | mark <state> | validate <dir> <slug>");
}
if (action === "prepare") {
  console.log(prepareRelease(dir, arg, ARTICLES, moscowDay()) ? "deploy" : "skip");
} else if (action === "mark") {
  markPublished(dir, moscowDay());
} else {
  readArticle(dir, arg);
}
