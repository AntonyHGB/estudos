import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export const palette = {background: '#0b1020', panel: '#141c30', text: '#f3f6fc', muted: '#b8c4d9', accent: '#71d5c1', gold: '#ffd479'};

export function Frame({title, children = null, label, domainLabel}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.min(14, fps / 2);
  const opacity = interpolate(frame, [0, duration], [0, 1], {extrapolateRight: 'clamp'});
  const y = interpolate(frame, [0, duration], [16, 0], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background: palette.background, color: palette.text, fontFamily: 'Arial,sans-serif', padding: '76px 112px', opacity, boxSizing: 'border-box'}}>
    <div style={{color: palette.accent, fontSize: 22, letterSpacing: 3, textTransform: 'uppercase'}}>{label}</div>
    <div style={{fontSize: 49, fontWeight: 700, lineHeight: 1.15, marginTop: 28, transform: `translateY(${y}px)`}}>{title}</div>
    <div style={{flex: 1, display: 'flex', alignItems: 'center', marginTop: 28, minHeight: 0}}>{children}</div>
    <div style={{position: 'absolute', bottom: 30, left: 112, right: 112, color: '#8290a7', fontSize: 17}}>{domainLabel ?? 'StudyForge'} · conteúdo derivado; status recebido da aula</div>
  </AbsoluteFill>;
}

export function BodyText({children, size = 32, color = palette.text}) {
  return <div style={{fontSize: size, color, lineHeight: 1.45, whiteSpace: 'pre-wrap', maxWidth: '100%'}}>{children}</div>;
}
