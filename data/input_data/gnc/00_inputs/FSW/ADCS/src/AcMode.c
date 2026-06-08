#include "AcFswModules.h"

const char *AcModeName[AC_NUM_MODES] = {
   "SAFE",
   "DETUMBLE",
   "ACQUIRE",
   "TRACK"
};

/**********************************************************************/
void AcDetermineMode(struct AcType *AC, struct AcModeStateType *State)
{
      long RateDamped;

      State->RateMag = MAGV(AC->wbn);
      State->SunValid = AC->SunValid;
      State->MagValid = AC->MagValid;
      State->StValid = AC->StValid;
      State->NavValid = AC->EphValid;
      State->AttValid = (AC->StValid || AC->SunValid || AC->MagValid ||
         AC->ES.Valid);
      RateDamped = (State->RateMag <= AC_DETUMBLE_RATE_LIMIT);

      State->NextMode = State->Mode;

      switch(State->Mode) {
         case AC_MODE_SAFE:
            if (State->ModeTime >= AC_SAFE_HOLD_TIME) {
               State->NextMode = AC_MODE_DETUMBLE;
            }
            break;

         case AC_MODE_DETUMBLE:
            if (RateDamped && State->AttValid) {
               State->NextMode = AC_MODE_ACQUIRE;
            }
            break;

         case AC_MODE_ACQUIRE:
            if (!State->AttValid) {
               State->NextMode = AC_MODE_DETUMBLE;
            }
            else if (State->ModeTime >= AC_ACQUIRE_HOLD_TIME &&
               State->NavValid) {
               State->NextMode = AC_MODE_TRACK;
            }
            break;

         case AC_MODE_TRACK:
            if (!State->AttValid || State->RateMag > AC_TRACK_LOST_RATE) {
               State->NextMode = AC_MODE_DETUMBLE;
            }
            break;

         default:
            State->NextMode = AC_MODE_SAFE;
            break;
      }
}

/**********************************************************************/
void AcOnModeEntry(struct AcType *AC, struct AcModeStateType *State)
{
      (void) AC;

      /*
      ** Mission-specific entry actions belong here.  Keep this function
      ** side-effect-light in the template: reset integrators, command
      ** actuator spin-up profiles, or latch targets in derived cases.
      */
      switch(State->Mode) {
         case AC_MODE_SAFE:
         case AC_MODE_DETUMBLE:
         case AC_MODE_ACQUIRE:
         case AC_MODE_TRACK:
         default:
            break;
      }
}
