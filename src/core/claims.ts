/* Rites whose failure a screen tells beside its own control. The global herald stays quiet for
 * these, so the same bad news is not shouted twice in two places. */
const claimed = new Set<string>();
export const claimJob = (id: string) => { claimed.add(id); };
/** True once for a claimed job (and forgets it): the herald asks before it speaks. */
export const takeClaim = (id: string) => claimed.delete(id);
/** A screen that stops listening (it was left) hands the job back to the herald. */
export const releaseClaim = (id: string) => { claimed.delete(id); };
