#include "AcFswModules.h"

void GyroProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void MagnetometerProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void CssProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void FssProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void StarTrackerProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void GpsProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
void AccelProcessing(struct AcType *AC)
{
      (void) AC;
}
/**********************************************************************/
static void AcSyncReferenceState(struct AcType *AC)
{
      double evn[3], evb[3];
      long i;

      /*
      ** Standard 42 sensor-state synchronization shell.
      **
      ** This workspace-local FSW runs after 42's SensorModule has populated AC with
      ** the standard sensor/truth-model outputs.  Mirror the non-modeling
      ** bookkeeping from codex_web/AIGNC/42/Source/42sensors.c using only fields already present
      ** in AC: attitude DCM, LVLH frame, LVLH quaternion/rate, ephemeris
      ** validity, and the coarse Earth-sensor roll/pitch surrogate.
      **
      ** Mission-specific processors may overwrite measured fields below, but
      ** this shell must not clear standard validity flags or reference state it
      ** does not own.
      */
      Q2C(AC->qbn,AC->CBN);

      if (MAGV(AC->PosN) > 0.0 && MAGV(AC->VelN) > 0.0) {
         FindCLN(AC->PosN,AC->VelN,AC->CLN,AC->wln);
         C2Q(AC->CLN,AC->qln);
         AC->EphValid = 1;
      }

      for(i=0;i<3;i++) evn[i] = -AC->PosN[i];
      if (MAGV(evn) > 0.0) {
         UNITV(evn);
         MxV(AC->CBN,evn,evb);
         if (evb[2] > 0.866) {
            AC->ES.Valid = 1;
            AC->ES.Roll = evb[1];
            AC->ES.Pitch = -evb[0];
         }
         else {
            AC->ES.Valid = 0;
            AC->ES.Roll = 0.0;
            AC->ES.Pitch = 0.0;
         }
      }
}
/**********************************************************************/
void AcProcessSensors(struct AcType *AC)
{
      AcSyncReferenceState(AC);

      GyroProcessing(AC);
      MagnetometerProcessing(AC);
      CssProcessing(AC);
      FssProcessing(AC);
      StarTrackerProcessing(AC);
      GpsProcessing(AC);
      AccelProcessing(AC);

      AcSyncReferenceState(AC);
}
