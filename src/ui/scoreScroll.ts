/** Let the cursor read down a stationary page. Move only the paper when the active staff leaves it. */
export function revealStaff(paper: HTMLElement, row: Element) {
  const viewport = paper.getBoundingClientRect();
  const staff = row.getBoundingClientRect();
  const above = staff.top - viewport.top;
  const below = staff.bottom - viewport.bottom;
  if (above < -1 || (below > 1 && staff.height > viewport.height)) paper.scrollTop += above;
  else if (below > 1) paper.scrollTop += below;
}
