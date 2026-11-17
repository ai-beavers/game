// The small dialog that asks for a name before playing together. Kept apart so a start screen can take the field
// over later: all the rest of the net feature needs is a name in settings.name.
//
//   askName(parent, current, address).then((name) => settings.set({ name }));
//
// It opens as a modal dialog on top of whatever is open (the HUD's start screen too). Escape keeps the old name when
// there is one; without one it waits for a name.
import { clean, NAME_LENGTH } from "./protocol.ts";

export function askName(parent: HTMLElement, current: string, address?: string): Promise<string> {
  const dialog = document.createElement("dialog");
  dialog.className = "net-name";
  dialog.setAttribute("aria-labelledby", "net-name-title");
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="net-name-title">Your name</h2>
      <p>Everyone on this network who opens the game plays in the same world and sees it over your beaver.</p>
      <input name="name" maxlength="${NAME_LENGTH}" autocomplete="nickname" spellcheck="false" required placeholder="Name">
      <button type="submit">Play</button>
      <p class="join" hidden>Others join at <b></b></p>
    </form>`;
  const input = dialog.querySelector("input")!, join = dialog.querySelector<HTMLElement>(".join")!;
  input.value = current;
  if (address) { join.hidden = false; join.querySelector("b")!.textContent = address; }
  parent.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
  return new Promise((done) => {
    dialog.addEventListener("cancel", (e) => { if (!current) e.preventDefault(); else input.value = current; });
    dialog.addEventListener("close", () => {
      dialog.remove();
      done(clean(input.value, NAME_LENGTH) || current);
    });
    dialog.querySelector("form")!.addEventListener("submit", (e) => {
      if (!clean(input.value, NAME_LENGTH)) { e.preventDefault(); input.focus(); }
    });
  });
}
