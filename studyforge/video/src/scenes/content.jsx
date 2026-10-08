import React from 'react';
import {Frame, BodyText, palette} from './layout.jsx';

export function TitleScene({title, domainLabel}) {return <Frame label="StudyForge · vídeo de estudo" domainLabel={domainLabel} title={title}/>;}
export function ConceptScene({title, text, domainLabel}) {return <Frame label="Conceito" domainLabel={domainLabel} title={title}><BodyText>{text}</BodyText></Frame>;}
export function QuestionScene({question, part, domainLabel}) {return <Frame label={`Recuperação ativa${part > 1 ? ` · parte ${part}` : ''}`} domainLabel={domainLabel} title="Tente responder"><BodyText size={37}>{question}</BodyText></Frame>;}
export function PauseScene({seconds, domainLabel}) {return <Frame label="Pausa para pensar" domainLabel={domainLabel} title={`Pause por ${seconds} segundos`}/>;}
export function AnswerScene({answer, part, domainLabel}) {return <Frame label={`Resposta da fonte${part > 1 ? ` · parte ${part}` : ''}`} domainLabel={domainLabel} title="Resposta"><BodyText>{answer}</BodyText></Frame>;}
export function PitfallScene({text, domainLabel}) {return <Frame label="Ponto de atenção da fonte" domainLabel={domainLabel} title="Armadilha"><BodyText>{text}</BodyText></Frame>;}
export function RecapScene({items, domainLabel}) {return <Frame label="Recapitulando" domainLabel={domainLabel} title="Resumo da aula"><div style={{fontSize: 28, lineHeight: 1.55}}>{items.map((item, index) => <div key={index}>• {item}</div>)}</div></Frame>;}
export function SourcesScene({sources, page, pageCount, domainLabel}) {
  return <Frame label={`Referências desta seleção · página ${page}/${pageCount}`} domainLabel={domainLabel} title="Fontes">
    <div style={{width: '100%', maxHeight: '100%', overflow: 'hidden', fontSize: 19, lineHeight: 1.42, overflowWrap: 'anywhere'}}>{sources.map((source, index) => <div key={`${source.kind}-${index}`} style={{marginBottom: 26}}>
      {source.kind === 'internal'
        ? <><div style={{fontWeight: 700}}>• {source.path}{source.anchor && /^\d+(?:\.\d+)*$/.test(source.anchor) ? ` · seção ${source.anchor}` : source.pointer ? ` · ${source.pointer}` : source.span ? ` · L${source.span.startLine}-${source.span.endLine}` : ''}</div><div style={{color: palette.muted}}>SHA-256 {source.sha256.slice(0, 12)}</div></>
        : <><div style={{fontWeight: 700}}>• {source.title}</div><div style={{color: palette.accent, overflowWrap: 'anywhere'}}>{source.url ?? 'URL inválida ou removida'}</div><div style={{color: palette.muted}}>{source.checkedAt ?? 'data não informada'} · {(source.claimStatuses ?? []).join(', ')}{source.redactedQuery ? ' · parâmetros privados removidos' : ''}</div></>}
    </div>)}</div>
  </Frame>;
}
