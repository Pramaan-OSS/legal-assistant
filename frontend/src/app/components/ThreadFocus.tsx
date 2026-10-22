'use client';
import { useEffect } from 'react';
/** Select one next action from existing primary controls; the reader remains a quiet workspace. */
export function ThreadFocus() {
 useEffect(() => {
  let frame = 0;
  const update = () => {
   frame = 0;
   const candidates = [...document.querySelectorAll<HTMLElement>('[data-primary], button[type="submit"], button[aria-label="Send message"]')];
   const choice = candidates.find(e => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length && !e.closest('.right,[data-slot="side-panel"]'));
   document.querySelectorAll('[data-thread]').forEach(e => { if (e !== choice) e.removeAttribute('data-thread'); });
   if (choice) choice.setAttribute('data-thread', '');
   const main = document.querySelector('main');
   if (choice) main?.removeAttribute('data-thread-none'); else main?.setAttribute('data-thread-none', 'waiting');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class'] });
  schedule();
  return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
 }, []);
 return null;
}
