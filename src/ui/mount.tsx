import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useMoppet } from "../choir/store";
import { buildCatalog } from "./SongNavigator";
import { App } from "./App.tsx";

export function mount(root: HTMLElement): void {
  const act = new URLSearchParams(location.search).get("act");
  const state = useMoppet.getState();
  const linked = act && buildCatalog(state.studio404, state.freshSkit?.title).some((item) => item.id === act);
  state.setLesson(linked ? act : state.lesson);
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
