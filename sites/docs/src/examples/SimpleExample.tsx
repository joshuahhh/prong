import { useState } from "react";

import {
  Editor,
  StandardBundle,
} from "../../../../packages/prong-editor/src/index";

const exampleData = `{
    "a": {
      "b": [1, 2, 3],
      "c": true,
    },
    "d": null,
    "e": [{ "f": -4, "g": 0 }],
    "I": "example",
  }`;

function SimpleExample() {
  const [currentCode, setCurrentCode] = useState(exampleData);

  return (
    <Editor
      schema={{}}
      code={currentCode}
      onChange={(x) => {
        setCurrentCode(x);
      }}
      projections={Object.values(StandardBundle)}
    />
  );
}

export default SimpleExample;
