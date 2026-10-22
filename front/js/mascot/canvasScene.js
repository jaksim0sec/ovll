/** Optional Canvas host adapter. Actor has no knowledge of block DOM/classes. */
export function createCanvasMascotScene(canvas){
  if(!canvas||typeof canvas.getActorHost!=='function'||
    typeof canvas.getBlockBounds!=='function'||typeof canvas.getSelectedBlockId!=='function')
    throw new TypeError('Canvas scene requires public Canvas geometry APIs');
  return Object.freeze({
    host:canvas.getActorHost(),
    getTargetBounds:id=>canvas.getBlockBounds(id),
    getSelection:()=>canvas.getSelectedBlockId(),
    focusTarget:id=>canvas.focusBlock(id),
    subscribeSelection(listener){
      const handler=event=>listener(event.detail.blockId);
      canvas.element.addEventListener('canvasblockfocus',handler);
      return ()=>canvas.element.removeEventListener('canvasblockfocus',handler);
    }
  });
}
