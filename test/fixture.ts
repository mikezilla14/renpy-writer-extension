export const FIXTURE = `define e = Character("Eileen")
define inventory = []
default points = 0

label start:
    e "Hello there! How are you?"
    "Narration line."
    $ points += 1
    $ mood = "happy"
    menu:
        "What now?"
        "Go to the party":
            jump party
        "Stay home" if points > 0:
            $ inventory.append("book")
            return

label party:
    e happy "Welcome!"
    jump ending

label .after_party:
    return

label ending:
    return

init python:
    flags = 0

screen stats():
    text "Points"
`;

/** 0-based line of the nth occurrence of `needle` in `src`. */
export function lineOf(src: string, needle: string, nth = 0): number {
  const lines = src.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      if (count === nth) return i;
      count++;
    }
  }
  throw new Error('needle not found: ' + needle);
}
