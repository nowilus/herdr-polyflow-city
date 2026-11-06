// The camera of a floor view: how big the floor is, the zoom that fits it, and the viewport around it (wheel
// zoom, drag to pan, the buttons on top). Shared by the picture floors and the grid floors.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { ZOOM } from "./grid.js";

export { ZOOM, clampPan, fitScale, worldSize } from "./grid.js";

const SIGN_FONT = "Silkscreen";
const WHEEL_NOTCH_PX = 40;

// The viewport around a floor's world: wheel zoom, drag to pan, and the buttons on top. Shared by both floor views.
export function cameraFrame(view, world, t) {
  const button = (id, label, action, title) => div().id(id).h(30).min_w(30).px(10).flex().items_center().justify_center().font_family(SIGN_FONT).text_size(12)
    .border(1).border_color(t.border).bg(`${t.surface}e6`).text_color(t.muted).cursor_pointer()
    .hover((x) => x.text_color(t.foreground).border_color(t.accent))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).tooltip(title).child(label);
  const hud = h_flex().absolute().left(10).top(10).gap(4).items_center()
    .child(button("floor-back", "< TOWER", (_e, cx) => view.onBack(cx), "Back to the tower"))
    .child(div().px(8).py(5).bg(`${t.background}d9`).border_l(2).border_color(t.accent).font_family(SIGN_FONT).text_size(13).text_color(t.accent).child(`TOWER > ${view.title}`))
    .child(button("floor-out", "-", (_e, cx) => view.onZoom(1 / ZOOM.step, null, cx), "Zoom out"))
    .child(button("floor-in", "+", (_e, cx) => view.onZoom(ZOOM.step, null, cx), "Zoom in"))
    .child(button("floor-fit", "FIT", (_e, cx) => view.onFit(cx), "Show the whole floor"))
    .when(Boolean(view.onInvite), (el) => el.child(button("floor-invite", "+ INVITE AGENT", () => view.onInvite(), "Start a new agent: it walks in through the front door")))
    .when(Boolean(view.canPan), (el) => el.child(div().id("floor-hint").ml(6).px(6).py(3).bg(`${t.background}b3`).font_family("Chakra Petch").text_size(12).text_color(t.muted)
      .tooltip("Zoomed in: drag to look around. Wheel: zoom. Click a person: their card (terminal, chat, message).")
      .child("DRAG TO LOOK AROUND")));
  return div().id("floor-view").size_full().relative().overflow_hidden().bg("#05070a")
    .when(Boolean(view.canPan), (el) => el.cursor_grab())
    .on_scroll_wheel((e, cx) => {
      // One wheel notch is one step; a touchpad's many small deltas add up to the same.
      const dy = Math.max(-1, Math.min(1, (e.delta?.y ?? 0) / WHEEL_NOTCH_PX));
      if (dy !== 0) view.onZoom(Math.pow(ZOOM.step, dy), e.local_position ?? null, cx);
    })
    .on_mouse_down("left", (e, cx) => view.onPanStart(e.position, cx))
    .on_mouse_move((e, cx) => view.onPanMove(e.position, cx))
    .on_mouse_up("left", (_e, cx) => view.onPanEnd(cx))
    .on_hover((hovered, cx) => { if (!hovered) view.onPanEnd(cx); }) // released outside: the drag ends
    .child(world)
    .child(hud);
}
