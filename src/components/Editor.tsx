import * as React from "react";
import { useEffect, useRef, useState } from "react";

import { json } from "@codemirror/lang-json";
import { Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";

import { lintCode, LintError } from "../lib/Linter";
import { createNodeMap } from "../lib/utils";
import { widgetsPlugin, Projection } from "../lib/widgets";
import {
  cmStatePlugin,
  setSchema,
  setProjections,
  setSchemaTypings,
  setDiagnostics,
} from "../lib/cmState";
import PopoverPlugin from "../lib/popover-menu";

type Props = {
  onChange: (code: string) => void;
  code: string;
  schema: any; // TODO fix
  projections?: Projection[];
};

const languageConf = new Compartment();

function calcWidgetRangeSets(v: ViewUpdate) {
  const decSets = (v.view as any).docView.decorations
    .map((x: any) => x.chunk[0])
    .filter((x: any) => x)
    .map((x: any) => x.value);

  const possibleSetTargets = decSets.find((decSet: any) =>
    decSet.some((dec: any) => dec.widget)
  );
  if (!possibleSetTargets) {
    return {};
  }
  const ranges = possibleSetTargets
    .filter((x: any) => x?.widget?.to)
    .reduce((acc: any, row: any) => {
      acc[`${row.widget.from}____${row.widget.to}`] = true;
      return acc;
    }, {});
  return ranges;
}

export type SchemaMap = Record<string, any>;

export default function Editor(props: Props) {
  const { schema, code, onChange, projections } = props;
  const cmParent = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<EditorView | null>(null);

  // TODO replace this with sets? Or maybe a custom data structure that makes query the ranges easier/faster
  const [widgetRangeSets, setWidgetRangeSets] = useState<
    Record<string, boolean>
  >({});
  const [selectionLocal, setSelection] = useState<any>(null);
  const [insideDecRange, setInsideRecRange] = useState<false | string>(false);

  const simpleUpdate = (
    view: EditorView,
    from: number,
    to: number,
    insert: string
  ) => {
    view.dispatch(view!.state.update({ changes: { from, to, insert } }));
  };

  // THIS TRIO OF EFFECTS HANDLES THE On/Off projection stuff, and it is very cursed, be warned
  // A. figures out the range sets for the projections
  useEffect(() => {
    const baseRange = selectionLocal && selectionLocal.ranges[0];
    if (!baseRange || baseRange.from !== baseRange.to) {
      return;
    }
    const insiderDecRange = Object.keys(widgetRangeSets).find((range) => {
      const [from, to] = range.split("____");
      return baseRange.from >= Number(from) && baseRange.from <= Number(to);
    });
    if (insiderDecRange) {
      setInsideRecRange(insiderDecRange);
    }
  }, [widgetRangeSets, selectionLocal]);
  // B. deactivate the projections if necessary
  useEffect(() => {
    if (!view || !insideDecRange) {
      return;
    }
    const [from, to] = insideDecRange.split("____").map((x) => Number(x));
    simpleUpdate(view, from, to, view!.state.sliceDoc(from, to));
  }, [insideDecRange, view]);
  // C. reactivate them if necessary
  useEffect(() => {
    if (!insideDecRange) {
      return;
    }
    const [from, to] = insideDecRange.split("____").map((x) => Number(x));
    const baseRange = selectionLocal.ranges[0];
    if (baseRange.from < from || baseRange.to > to) {
      setInsideRecRange(false);
      simpleUpdate(view!, from, to, view!.state.sliceDoc(from, to));
    }
  }, [view, insideDecRange, selectionLocal]);

  // primary effect, initialize the editor etc
  useEffect(() => {
    // let localRangeSets = {};
    // let selection: EditorSelection | null;
    const localExtension = EditorView.updateListener.of((v: ViewUpdate) => {
      if (v.docChanged) {
        const newCode = v.state.doc.toString();
        onChange(newCode);
        const localRangeSets = calcWidgetRangeSets(v);
        setWidgetRangeSets(localRangeSets);

        // TODO wrap these is a debounce
        // TODO move these into the cmState
        createNodeMap(schema, newCode).then((schemaMap) => {
          // setSchemaMap(schemaMap);
          view.dispatch({
            effects: [setSchemaTypings.of(schemaMap)],
          });
        });
        lintCode(schema, newCode).then((diagnostics) => {
          view.dispatch({
            effects: [setDiagnostics.of(diagnostics)],
          });
          // setLints(diagnostics);
        });
      } else {
        const newSelection = v.view.state.selection;
        // determine if the new selection
        // console.log(v, newSelection, selection);
        // const clickInSideOfRange = Object.keys(localRangeSets).some(
        //   (x) => {
        //     const [newFrom, newTo] = x.split("____").map(Number);
        //     const { from, to } = newSelection.ranges[0];
        //     return from >= newFrom && to <= newTo;
        //   }
        // );
        // if (clickInSideOfRange && selection) {
        //   view.dispatch({ selection });
        // } else {
        setSelection(newSelection);
        //   selection = newSelection;
        // }
      }
    });
    const editorState = EditorState.create({
      extensions: [
        PopoverPlugin(),
        basicSetup,
        languageConf.of(json()),
        // keymap.of([indentWithTab]),
        cmStatePlugin,
        widgetsPlugin,
        localExtension,
      ],
      doc: code,
    })!;
    const view = new EditorView({
      state: editorState,
      parent: cmParent.current!,
    });
    setView(view);
    // HACK:
    // we want to trigger an update after the widgets are initially computed in order to capture their ranges in the on change event
    // maybe could be an effect, but we'll see
    setTimeout(() => simpleUpdate(view, 0, view.state.doc.length, code), 500);
    return () => view.destroy();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (view) {
      view.dispatch({ effects: [setSchema.of(schema)] });
    }
  }, [schema, view]);
  useEffect(() => {
    if (view) {
      // hack :(
      setTimeout(() => {
        view.dispatch({ effects: [setProjections.of(projections || [])] });
      }, 500);
    }
  }, [projections, view]);

  useEffect(() => {
    if (view && view.state.doc.toString() !== code) {
      console.log("here");
      const tr = view.state.update({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
      view.dispatch(tr);
    }
  }, [code, view]);
  return (
    <div className="editor-container">
      <div ref={cmParent} />
    </div>
  );
}
