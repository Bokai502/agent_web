#ifndef __AC_FSW_MODULES_H__
#define __AC_FSW_MODULES_H__

#include "Ac.h"
#include "AcOpticalPayload.h"

/*
** Minimal ADCS FSW framework for new cases.
**
** This header preserves the module boundaries used by the case-local
** Makefile. Mission-specific sensors, modes, control laws, and actuator
** allocation should be added in the corresponding source files.
*/

#define AC_MODE_SAFE        0
#define AC_MODE_DETUMBLE    1
#define AC_MODE_ACQUIRE     2
#define AC_MODE_TRACK       3
#define AC_NUM_MODES        4
#define AC_MAX_STATE_SC    64

#define AC_SAFE_HOLD_TIME       5.0
#define AC_DETUMBLE_RATE_LIMIT  0.01
#define AC_ACQUIRE_HOLD_TIME    30.0
#define AC_TRACK_LOST_RATE      0.05

#define AC_DETUMBLE_GAIN        2.0E5
#define AC_ACQUIRE_KR           2.0E-3
#define AC_ACQUIRE_KP           1.0E-3
#define AC_TRACK_KR             5.0E-3
#define AC_TRACK_KP             2.0E-3
#define AC_MAX_TORQUE_CMD       1.0E-2
#define AC_MAX_DIPOLE_CMD       20.0

struct AcModeStateType {
   long Mode;
   long PrevMode;
   long NextMode;
   long ModeChanged;
   double ModeTime;
   double FswTime;
   double RateMag;
   long AttValid;
   long NavValid;
   long SunValid;
   long MagValid;
   long StValid;
};

extern const char *AcModeName[AC_NUM_MODES];

void FindCLN(double r[3], double v[3], double CLN[3][3], double wln[3]);
void GyroProcessing(struct AcType *AC);
void MagnetometerProcessing(struct AcType *AC);
void CssProcessing(struct AcType *AC);
void FssProcessing(struct AcType *AC);
void StarTrackerProcessing(struct AcType *AC);
void GpsProcessing(struct AcType *AC);
void AccelProcessing(struct AcType *AC);
void AcProcessSensors(struct AcType *AC);
void ZeroAcCommands(struct AcType *AC);
void AcApplyControl(struct AcType *AC, long Mode, double ModeTime);
void AcDetermineMode(struct AcType *AC, struct AcModeStateType *State);
void AcOnModeEntry(struct AcType *AC, struct AcModeStateType *State);
void WheelProcessing(struct AcType *AC);
void MtbProcessing(struct AcType *AC);
void AcDispatchActuators(struct AcType *AC, long Mode);
void AcFsw(struct AcType *AC);

#endif
