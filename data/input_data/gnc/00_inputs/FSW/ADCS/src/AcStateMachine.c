#include "AcFswModules.h"

/**********************************************************************/
void AcFsw(struct AcType *AC)
{
      static struct AcModeStateType State[AC_MAX_STATE_SC];
      long Idx;

      Idx = (AC->ID >= 0 && AC->ID < AC_MAX_STATE_SC) ? AC->ID : 0;

      if (AC->CfsCtrl.Init) {
         AC->CfsCtrl.Init = 0;
         State[Idx].Mode = AC_MODE_SAFE;
         State[Idx].PrevMode = AC_MODE_SAFE;
         State[Idx].NextMode = AC_MODE_SAFE;
         State[Idx].ModeChanged = 1;
         State[Idx].ModeTime = 0.0;
         State[Idx].FswTime = 0.0;
         State[Idx].RateMag = 0.0;
         State[Idx].AttValid = 0;
         State[Idx].NavValid = 0;
         State[Idx].SunValid = 0;
         State[Idx].MagValid = 0;
         State[Idx].StValid = 0;
         AcOnModeEntry(AC,&State[Idx]);
      }

      AcProcessSensors(AC);
      ZeroAcCommands(AC);
      AcDetermineMode(AC,&State[Idx]);

      State[Idx].ModeChanged = (State[Idx].NextMode != State[Idx].Mode);
      if (State[Idx].ModeChanged) {
         State[Idx].PrevMode = State[Idx].Mode;
         State[Idx].Mode = State[Idx].NextMode;
         State[Idx].ModeTime = 0.0;
         AcOnModeEntry(AC,&State[Idx]);
      }
      else {
         State[Idx].ModeTime += AC->DT;
      }

      AcApplyControl(AC,State[Idx].Mode,State[Idx].ModeTime);

      State[Idx].FswTime += AC->DT;
      AC->Mode = State[Idx].Mode;

      AcDispatchActuators(AC,AC->Mode);
}
