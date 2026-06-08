#include "AcFswModules.h"

/**********************************************************************/
void ZeroAcCommands(struct AcType *AC)
{
      long i;

      for(i=0;i<3;i++) {
         AC->Tcmd[i] = 0.0;
         AC->Mcmd[i] = 0.0;
         AC->Fcmd[i] = 0.0;
         AC->IdealTrq[i] = 0.0;
         AC->IdealFrc[i] = 0.0;
      }
}
/**********************************************************************/
static void AcLimitVector(double V[3], double MaxMag)
{
      double Mag;
      long i;

      Mag = MAGV(V);
      if (Mag > MaxMag && Mag > 0.0) {
         for(i=0;i<3;i++) V[i] *= MaxMag/Mag;
      }
}
/**********************************************************************/
static void AcCommandTorque(struct AcType *AC, double Tcmd[3])
{
      double B2;
      double BxT[3];
      long i;

      AcLimitVector(Tcmd,AC_MAX_TORQUE_CMD);

      for(i=0;i<3;i++) {
         AC->Tcmd[i] = Tcmd[i];
         AC->IdealTrq[i] = Tcmd[i];
      }

      if (AC->Nmtb > 0 && AC->MagValid) {
         B2 = VoV(AC->bvb,AC->bvb);
         if (B2 > 0.0) {
            VxV(AC->bvb,Tcmd,BxT);
            for(i=0;i<3;i++) {
               AC->Mcmd[i] = Limit(BxT[i]/B2,-AC_MAX_DIPOLE_CMD,
                  AC_MAX_DIPOLE_CMD);
            }
         }
      }
}
/**********************************************************************/
static void AcSafeControl(struct AcType *AC, double ModeTime)
{
      (void) AC;
      (void) ModeTime;

      /* Safe is intentionally quiet in the template. */
}
/**********************************************************************/
static void AcDetumbleControl(struct AcType *AC, double ModeTime)
{
      double Tcmd[3];
      long i;

      (void) ModeTime;

      for(i=0;i<3;i++) {
         Tcmd[i] = -AC_DETUMBLE_GAIN*AC->wbn[i];
      }
      AcCommandTorque(AC,Tcmd);
}
/**********************************************************************/
static void AcAcquireControl(struct AcType *AC, double ModeTime)
{
      double Tcmd[3];
      long i;

      (void) ModeTime;

      for(i=0;i<3;i++) {
         Tcmd[i] = -AC_ACQUIRE_KR*AC->wbn[i];
      }

      if (AC->ES.Valid) {
         Tcmd[0] += -AC_ACQUIRE_KP*AC->ES.Roll;
         Tcmd[1] += -AC_ACQUIRE_KP*AC->ES.Pitch;
      }

      AcCommandTorque(AC,Tcmd);
}
/**********************************************************************/
static void AcTrackControl(struct AcType *AC, double ModeTime)
{
      double Tcmd[3];
      double werr[3];
      long i;

      (void) ModeTime;

      if (AC->EphValid) {
         QxQT(AC->qbn,AC->qln,AC->qbr);
         RECTIFYQ(AC->qbr);
      }

      for(i=0;i<3;i++) {
         werr[i] = AC->wbn[i] - (AC->EphValid ? AC->wln[i] : 0.0);
         Tcmd[i] = -AC_TRACK_KR*werr[i] - AC_TRACK_KP*2.0*AC->qbr[i];
      }

      AcCommandTorque(AC,Tcmd);
}
/**********************************************************************/
void AcApplyControl(struct AcType *AC, long Mode, double ModeTime)
{
      switch(Mode) {
         case AC_MODE_SAFE:
            AcSafeControl(AC,ModeTime);
            break;

         case AC_MODE_DETUMBLE:
            AcDetumbleControl(AC,ModeTime);
            break;

         case AC_MODE_ACQUIRE:
            AcAcquireControl(AC,ModeTime);
            break;

         case AC_MODE_TRACK:
            AcTrackControl(AC,ModeTime);
            break;

         default:
            AcSafeControl(AC,ModeTime);
            break;
      }
}
