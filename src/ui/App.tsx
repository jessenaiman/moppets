/**
 * The Moppets app: Unified live interactive CHIMERA + true Three.js 2.5D/3D stage everywhere
 * (localhost AND Vercel, plus `?watch=<song>`, `?act=<song>`, `?cast` Character Bible gallery,
 * and `?chimera` for the full native CHIMERA acoustic vocal synthesizer workbench).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMoppet, type Lesson } from "../choir/store.ts";

const MoppetRight = lazy(() => import("./MoppetPanel.tsx").then((m) => ({ default: m.MoppetRight })));
const ScreeningRoom = lazy(() => import("./ScreeningRoom.tsx").then((m) => ({ default: m.ScreeningRoom })));
const CastGallery = lazy(() => import("./CastGallery.tsx").then((m) => ({ default: m.CastGallery })));
const SongbookPage = lazy(() => import("./SongbookStoryboardView.tsx").then((m) => ({ default: m.SongbookPage })));
const ChimeraWorkbench = lazy(() => import("@chimera/ui/App.tsx").then((m) => ({ default: m.App })));

type Surface = "cast" | "watch" | "songbook" | "chimera" | "live";

interface RouteState {
  surface: Surface;
  watch: string;
  songbook: string;
  act: string | null;
}

function resolveRoute(): RouteState {
  const params = new URLSearchParams(window.location.search);
  if (params.has("chimera") || params.has("show")) {
    return { surface: "chimera", watch: "", songbook: "", act: null };
  }
  if (params.has("cast")) {
    return { surface: "cast", watch: "", songbook: "", act: null };
  }
  const songbook = params.get("songbook");
  if (songbook !== null) {
    return { surface: "songbook", watch: "", songbook: songbook || "found", act: null };
  }
  const watch = params.get("watch");
  if (watch !== null) {
    return { surface: "watch", watch: watch || "tabby-solo", songbook: "", act: null };
  }
  const act = params.get("act");
  return { surface: "live", watch: "", songbook: "", act };
}

export function App() {
  const [route, setRoute] = useState<RouteState>(resolveRoute);

  useEffect(() => {
    const onPopState = () => {
      setRoute(resolveRoute());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route.act && useMoppet.getState().lesson !== route.act) {
      useMoppet.getState().setLesson(route.act as Lesson);
    }
  }, [route.act]);

  return (
    <TooltipProvider>
      <Suspense fallback={null}>
        {route.surface === "chimera" ? (
          <ChimeraWorkbench />
        ) : route.surface === "cast" ? (
          <CastGallery />
        ) : route.surface === "songbook" ? (
          <SongbookPage id={route.songbook} />
        ) : route.surface === "watch" ? (
          <ScreeningRoom id={route.watch} />
        ) : (
          <div className="app text-colors mode-moppet">
            <MoppetRight />
          </div>
        )}
      </Suspense>
    </TooltipProvider>
  );
}
