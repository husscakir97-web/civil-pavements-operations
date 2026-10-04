// Which way did the browser move? `stack` holds the hashes of the history entries this page load has seen and `at` the one
// on screen. Returns the offset to the nearest entry with that hash (negative = Back; a tie prefers Back), or 0 when it is a new entry.
// History state is deliberately left alone: Next's router reloads the page on state it did not write.
export function historyOffset(stack:string[],at:number,hash:string):number{
 let best=0;
 for(let j=0;j<stack.length;j++)if(j!==at&&stack[j]===hash&&(best===0||Math.abs(j-at)<Math.abs(best)))best=j-at;
 return best;
}
