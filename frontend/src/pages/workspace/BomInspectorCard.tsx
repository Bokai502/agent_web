import type { TFunction } from "i18next"
import type { BomComponent, BomInfo } from "../../components/bomData"
import { getBomPrimaryName } from "./bomDisplay"

type BomInspectorCardProps = {
  bomInfo: BomInfo
  bomLoading: boolean
  components: BomComponent[]
  onOpenBom: (componentId: string) => void
  selectedBomId: string
  t: TFunction
}

export function BomInspectorCard({ bomInfo, bomLoading, components, onOpenBom, selectedBomId, t }: BomInspectorCardProps) {
  return (
    <section className="wa-info-card">
      <h3>{t("workspace.inspector.bomTitle")}</h3>
      <p>{bomLoading ? `${t("workspace.stage.loadingBom")}...` : t("workspace.inspector.bomSummary", { count: bomInfo.totalRecords })}</p>
      <div className="wa-bom-list">
        {components.map(component => (
          <button
            type="button"
            className={`wa-bom-row${component.componentId === selectedBomId ? " selected" : ""}`}
            key={component.componentId}
            onClick={() => onOpenBom(component.componentId)}
          >
            <span className="wa-bom-row-top">
              <span className="wa-bom-id">{component.componentId}</span>
              <strong title={getBomPrimaryName(component)}>{getBomPrimaryName(component)}</strong>
              <small>x{component.quantity}</small>
            </span>
          </button>
        ))}
        {bomInfo.components.length === 0 && (
          <div className="wa-file">
            <span>{t("workspace.inspector.noBomData")}</span>
            <small>-</small>
          </div>
        )}
      </div>
    </section>
  )
}
