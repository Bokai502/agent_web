#include "AcFswModules.h"

/**********************************************************************/
void WheelProcessing(struct AcType *AC)
{
      long i;

      for(i=0;i<AC->Nwhl;i++) {
         AC->Whl[i].Tcmd = Limit(VoV(AC->Tcmd,AC->Whl[i].DistVec),
            -AC->Whl[i].Tmax,AC->Whl[i].Tmax);
      }
}
/**********************************************************************/
void MtbProcessing(struct AcType *AC)
{
      long i;

      for(i=0;i<AC->Nmtb;i++) {
         AC->MTB[i].Mcmd = Limit(VoV(AC->Mcmd,AC->MTB[i].DistVec),
            -AC->MTB[i].Mmax,AC->MTB[i].Mmax);
      }
}
/**********************************************************************/
static void ThrProcessing(struct AcType *AC)
{
      long i;
      double fcmd;

      for(i=0;i<AC->Nthr;i++) {
         fcmd = VoV(AC->Fcmd,AC->Thr[i].Axis);
         fcmd = Limit(fcmd,0.0,AC->Thr[i].Fmax);
         AC->Thr[i].Fcmd = fcmd;
         AC->Thr[i].ThrustLevelCmd = (AC->Thr[i].Fmax > 0.0) ?
            fcmd/AC->Thr[i].Fmax : 0.0;
         AC->Thr[i].PulseWidthCmd = AC->Thr[i].ThrustLevelCmd*AC->DT;
      }
}
/**********************************************************************/
void AcDispatchActuators(struct AcType *AC, long Mode)
{
      (void) Mode;

      /*
      ** Standard 42 actuator-dispatch shell.
      **
      ** 42's MapCmdsToActuators copies these AC command fields into the
      ** simulator actuator objects.  Mission control laws may command:
      **   AC->IdealTrq/IdealFrc directly for ideal actuators,
      **   AC->Tcmd for wheel torque allocation,
      **   AC->Mcmd for magnetic dipole allocation,
      **   AC->Fcmd for simple positive-thrust projection.
      */
      WheelProcessing(AC);
      MtbProcessing(AC);
      ThrProcessing(AC);
}
