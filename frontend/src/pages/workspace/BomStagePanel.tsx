import type { TFunction } from "i18next"
import { createImageUrl } from "../../components/bomData"
import type { BomComponent, BomInfo } from "../../components/bomData"
import { formatBomValue, getBomDisplayName, getBomPrimaryName } from "./bomDisplay"

type BomStagePanelProps = {
  bomInfo: BomInfo
  bomLoading: boolean
  onSelectBom: (componentId: string) => void
  selectedBom?: BomComponent
  t: TFunction
}

export function BomStagePanel({ bomInfo, bomLoading, onSelectBom, selectedBom, t }: BomStagePanelProps) {
  return (
    <div className="wa-bom-stage">
      <div className="wa-bom-stage-inner">
        <h2>{t("workspace.stage.bomTitle")}</h2>
        <p>{bomLoading ? `${t("workspace.stage.loadingBom")}...` : t("workspace.stage.bomSummary", { count: bomInfo.totalRecords })}</p>
        {selectedBom ? (
          <div className="wa-bom-detail">
            <div className="wa-bom-detail-card">
              {selectedBom.imageExists && selectedBom.imagePath ? (
                <img
                  alt={getBomDisplayName(selectedBom)}
                  src={createImageUrl(selectedBom.imagePath) ?? ""}
                />
              ) : (
                <div className="wa-file">
                  <span>{t("workspace.stage.noComponentImage")}</span>
                  <small>-</small>
                </div>
              )}
            </div>
            <div className="wa-bom-detail-card">
              <h3>{selectedBom.componentId} · {getBomPrimaryName(selectedBom)}</h3>
              <p>{selectedBom.description}</p>
              <div className="wa-bom-detail-fields">
                {[
                  [t("workspace.bomFields.componentId"), selectedBom.componentId],
                  [t("workspace.bomFields.semanticName"), selectedBom.semanticName],
                  [t("workspace.bomFields.model"), selectedBom.model],
                  [t("workspace.bomFields.quantity"), selectedBom.quantity],
                  [t("workspace.bomFields.subsystem"), selectedBom.subsystem],
                  [t("workspace.bomFields.kind"), selectedBom.kind],
                  [t("workspace.bomFields.category"), selectedBom.category],
                  [t("workspace.bomFields.dimensions"), selectedBom.dimensions || selectedBom.sizeMm],
                  [t("workspace.bomFields.mass"), selectedBom.massKg === null ? "-" : `${selectedBom.massKg} kg`],
                  [t("workspace.bomFields.power"), selectedBom.powerW === null ? "-" : `${selectedBom.powerW} W`],
                  [t("workspace.bomFields.material"), selectedBom.material],
                  [t("workspace.bomFields.mountFace"), selectedBom.mountFace],
                  [t("workspace.bomFields.source"), selectedBom.source],
                  ...Object.entries(selectedBom.thermal).map(([label, value]) => [t("workspace.bomFields.thermal", { label }), value]),
                ].map(([label, value]) => (
                  <div className="wa-bom-field" key={String(label)}>
                    <span>{String(label)}</span>
                    <strong>{formatBomValue(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="wa-bom-stage-grid">
            {bomInfo.components.slice(0, 12).map(component => (
              <button
                type="button"
                key={component.componentId}
                onClick={() => onSelectBom(component.componentId)}
              >
                <span className="wa-bom-id">{component.componentId}</span>
                <strong>{getBomPrimaryName(component)}</strong>
                <small>{component.subsystem || component.kind || t("common.component")} · x{component.quantity}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
