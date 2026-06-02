const SPLINE_URL = 'https://my.spline.design/r4xbot-yHAR8Unvi3rV012ud2gYNtwD/'

export default function SplineBotPage() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <iframe
        src={SPLINE_URL}
        title="Spline Bot"
        frameBorder="0"
        width="100%"
        height="100%"
        allow="fullscreen; xr-spatial-tracking; autoplay"
        loading="eager"
      />
    </div>
  )
}
