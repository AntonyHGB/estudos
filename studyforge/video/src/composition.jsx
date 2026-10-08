import React from 'react';
import { Audio, AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { sceneComponents } from './scenes/index.jsx';
function BurnedCaption({scenes}) {
  const frame = useCurrentFrame();
  const cue = scenes.flatMap(scene => scene.captionCues).find(item => frame >= item.startFrame && frame < item.endFrame);
  if (!cue) return null;
  return <div style={{position: 'absolute', bottom: 76, left: 160, right: 160, textAlign: 'center', fontFamily: 'Arial,sans-serif', fontSize: 22, lineHeight: 1.3, color: 'white', textShadow: '0 2px 5px #000', background: 'rgba(5,8,15,.82)', padding: '10px 18px', borderRadius: 8}}>
    {cue.lines.map((line, index) => <div key={index}>{line}</div>)}
  </div>;
}
/** @param {any} props */
export function VideoComposition(props) {
  const {video, audioAsset} = props;
  return <AbsoluteFill>
    {video.scenes.map((scene, index) => {
      const Component = sceneComponents[scene.kind];
      if (!Component) throw new TypeError(`Cena desconhecida: ${scene.kind}`);
      return <Sequence key={`${scene.kind}-${index}`} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
        <Component {...scene.props}/>
      </Sequence>;
    })}
    <BurnedCaption scenes={video.scenes}/>
    {audioAsset ? <Audio src={staticFile(audioAsset)} volume={0.8}/> : null}
  </AbsoluteFill>;
}
export const calculateMetadata=({props})=>({durationInFrames:props.video.durationInFrames,fps:props.video.fps,width:props.video.width,height:props.video.height});
