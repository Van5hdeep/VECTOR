const HudFrame = () => {
  return (
    <div className="hud-frame" aria-hidden="true">
      <div className="hud-frame__corner hud-frame__corner--tl" />
      <div className="hud-frame__corner hud-frame__corner--tr" />
      <div className="hud-frame__corner hud-frame__corner--bl" />
      <div className="hud-frame__corner hud-frame__corner--br" />
      <div className="hud-frame__line-top" />
      <div className="hud-frame__line-bottom" />
    </div>
  );
};

export default HudFrame;
