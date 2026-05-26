import Spline from "@splinetool/react-spline"
import { useTranslation } from "react-i18next"
import { LanguageSwitch } from "../components/LanguageSwitch"

const SCENE_URL = "https://prod.spline.design/lZmPK4GMpqiyvhx0/scene.splinecode"

const STYLE = `
.spline-page {
  min-height: 100vh;
  overflow: hidden;
  background: #ffffff;
  color: #111827;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
.spline-experience {
  position: relative;
  min-height: 100vh;
  isolation: isolate;
  background:
    radial-gradient(circle at 78% 18%, rgba(65, 112, 216, 0.2), transparent 30%),
    radial-gradient(circle at 18% 28%, rgba(45, 158, 116, 0.12), transparent 28%),
    linear-gradient(180deg, #eef4fb 0%, #f8fbff 66%, #ffffff 100%);
}
.spline-stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
}
.spline-stage > div {
  position: absolute !important;
  inset: 0 -18vw 0 -18vw !important;
  width: auto !important;
  height: 100% !important;
}
.spline-stage::before,
.spline-stage::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.spline-stage::before {
  z-index: 2;
  background:
    linear-gradient(90deg, rgba(238, 244, 251, 0.34) 0%, rgba(238, 244, 251, 0.18) 22%, rgba(238, 244, 251, 0.03) 46%, rgba(238, 244, 251, 0) 100%),
    radial-gradient(circle at 44% 45%, transparent 0 46%, rgba(238, 244, 251, 0.06) 78%);
}
.spline-stage::after {
  z-index: 3;
  background: linear-gradient(180deg, transparent 0%, transparent 50%, rgba(255, 255, 255, 0.68) 78%, #ffffff 100%);
}
.spline-scene {
  width: 100%;
  height: 100%;
  transform: translateX(6vw) scale(1.03);
  transform-origin: center right;
}
.spline-scene canvas {
  outline: none;
}
.spline-topbar {
  position: relative;
  z-index: 5;
  display: flex;
  width: min(1180px, calc(100vw - 48px));
  height: 68px;
  margin: 0 auto;
  align-items: center;
  justify-content: space-between;
}
.spline-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
}
.spline-brand-mark {
  width: 44px;
  height: auto;
  display: block;
}
.spline-nav {
  display: flex;
  align-items: center;
  gap: 18px;
  color: rgba(17, 24, 39, 0.62);
  font-size: 12px;
  font-weight: 700;
}
.spline-nav a {
  color: inherit;
  text-decoration: none;
}
.spline-topbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.spline-copy {
  position: relative;
  z-index: 4;
  width: min(1180px, calc(100vw - 48px));
  margin: 0 auto;
  padding-top: max(72px, 12vh);
  pointer-events: none;
}
.spline-kicker {
  color: #315fd3;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.spline-title {
  max-width: 520px;
  margin: 18px 0 0;
  color: #0f172a;
  font-size: clamp(40px, 5.9vw, 72px);
  font-weight: 780;
  letter-spacing: 0;
  line-height: 0.98;
  text-shadow: 0 1px 18px rgba(255, 255, 255, 0.82);
}
.spline-subtitle {
  max-width: 390px;
  margin: 20px 0 0;
  color: rgba(15, 23, 42, 0.64);
  font-size: clamp(16px, 1.6vw, 19px);
  line-height: 1.48;
  text-shadow: 0 1px 14px rgba(255, 255, 255, 0.78);
}
.spline-dock {
  position: absolute;
  left: 50%;
  bottom: 34px;
  z-index: 6;
  display: grid;
  width: min(1020px, calc(100vw - 48px));
  min-height: 92px;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: center;
  padding: 16px 18px 16px 22px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 26px 80px rgba(30, 42, 70, 0.16);
  backdrop-filter: blur(24px) saturate(170%);
  transform: translateX(-50%);
}
.spline-dock-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.spline-stat {
  min-width: 0;
}
.spline-stat strong,
.spline-stat span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spline-stat strong {
  color: #111827;
  font-size: 15px;
  font-weight: 800;
}
.spline-stat span {
  margin-top: 4px;
  color: rgba(17, 24, 39, 0.54);
  font-size: 12px;
}
.spline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spline-button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: #111827;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}
.spline-button.primary {
  border-color: #111827;
  background: #111827;
  color: #ffffff;
}
@media (max-width: 900px) {
  .spline-topbar {
    width: min(100vw - 32px, 680px);
  }
  .spline-nav {
    display: none;
  }
  .spline-copy {
    width: min(100vw - 32px, 680px);
    padding-top: 50px;
  }
  .spline-stage::before {
    background:
      linear-gradient(180deg, rgba(238, 244, 251, 0.42) 0%, rgba(238, 244, 251, 0.18) 32%, rgba(238, 244, 251, 0) 62%),
      radial-gradient(circle at 50% 42%, transparent 0 38%, rgba(238, 244, 251, 0.06) 74%);
  }
  .spline-scene {
    transform: translateX(0) scale(1.04);
    transform-origin: center;
  }
  .spline-stage > div {
    inset: 0 !important;
  }
  .spline-title {
    max-width: 520px;
    font-size: clamp(40px, 13vw, 64px);
  }
  .spline-subtitle {
    max-width: 430px;
    font-size: 17px;
  }
  .spline-dock {
    width: min(100vw - 32px, 680px);
    grid-template-columns: 1fr;
    bottom: 18px;
    padding: 14px;
    border-radius: 20px;
  }
  .spline-dock-meta {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .spline-actions {
    justify-content: stretch;
  }
  .spline-button {
    flex: 1;
  }
}
`

export default function HomePage() {
  const { t } = useTranslation()

  return (
    <main className="spline-page">
      <style>{STYLE}</style>
      <section className="spline-experience" aria-labelledby="spline-title">
        <div className="spline-stage" aria-label={t("landing.sceneAria")}>
          <Spline className="spline-scene" scene={SCENE_URL} />
        </div>

        <header className="spline-topbar">
          <a className="spline-brand" href="/" aria-label={t("landing.brandAria")}>
            <img className="spline-brand-mark" src="/logo_1.png" alt="" />
            <span>{t("landing.brand")}</span>
          </a>
          <div className="spline-topbar-actions">
            <nav className="spline-nav" aria-label={t("landing.navAria")}>
              <a href="/">{t("landing.nav.home")}</a>
              <a href="/workspace">{t("landing.nav.workspace")}</a>
              <a href="/viewer">{t("landing.nav.viewer")}</a>
              <a href="http://10.110.34.116:5173/" target="_blank" rel="noreferrer">{t("landing.nav.earth")}</a>
            </nav>
            <LanguageSwitch />
          </div>
        </header>

        <div className="spline-copy">
          <div className="spline-kicker">{t("landing.kicker")}</div>
          <h1 className="spline-title" id="spline-title">{t("landing.title")}</h1>
          <p className="spline-subtitle">
            {t("landing.subtitle")}
          </p>
        </div>

        <aside className="spline-dock" aria-label={t("landing.capabilitiesAria")}>
          <div className="spline-dock-meta">
            <div className="spline-stat">
              <strong>{t("landing.stats.sessionsTitle")}</strong>
              <span>{t("landing.stats.sessionsText")}</span>
            </div>
            <div className="spline-stat">
              <strong>{t("landing.stats.workspaceTitle")}</strong>
              <span>{t("landing.stats.workspaceText")}</span>
            </div>
            <div className="spline-stat">
              <strong>{t("landing.stats.skillsTitle")}</strong>
              <span>{t("landing.stats.skillsText")}</span>
            </div>
          </div>
          <div className="spline-actions">
            <a className="spline-button primary" href="/workspace">{t("landing.actions.workspace")}</a>
            <a className="spline-button primary" href="/gnc-workspace">{t("landing.actions.gnc")}</a>
          </div>
        </aside>
      </section>
    </main>
  )
}
