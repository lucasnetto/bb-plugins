import { setCustomExtension } from "@pierre/diffs";

// Pierre recognizes Clojure source extensions but treats EDN data files as plain text.
setCustomExtension("edn", "clojure");
