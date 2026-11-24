import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadPiece } from "../choir/ensemble";
import { useMoppet } from "../choir/store";
import { buildCatalog } from "./SongNavigator";
import { App } from "./App.tsx";

export function mount(root: HTMLElement): void {
  const act = new URLSearchParams(location.search).get("act");
  const state = useMoppet.getState();
  if (act && act !== state.lesson && buildCatalog(state.studio404, state.freshSkit?.title).some(item => item.id === act)) {
    state.setLesson(act);
  } else {
    loadPiece(state.piece);
    state.select(state.selected);
  }
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
