/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

#include "42.h"

void AcFsw(struct AcType *AC);

/**********************************************************************/
long FswCmdInterpreter(char CmdLine[512],double *CmdTime)
{
      long Isc;
      char response[80];

      if (sscanf(CmdLine,"%lf SC[%ld] FswTag = %s",
         CmdTime,&Isc,response) == 3) {
         SC[Isc].FswTag = DecodeString(response);
         return TRUE;
      }

      return FALSE;
}
/**********************************************************************/
void InitAC(struct SCType *S)
{
      long Ib,Ig,i,j,k;
      struct AcType *AC;
      double **A,**Aplus;
      double r[3];

      AC = &S->AC;

      S->InitAC = 0;
      AC->Init = 1;
      
      AC->ID = S->ID;
      
      /* Fundamental Constants */
      AC->Pi = Pi;
      AC->TwoPi = TwoPi;
      
      /* Time, Mass */
      AC->DT = S->FswSampleTime;
      AC->mass = S->mass;
      for (i=0;i<3;i++) {
         AC->cm[i] = S->cm[i];
         for(j=0;j<3;j++) {
            AC->MOI[i][j] = S->I[i][j];
         }
      }
      
      /* Bodies */
      AC->Nb = S->Nb;
      if (AC->Nb > 0) {
         AC->B = (struct AcBodyType *) calloc(AC->Nb,sizeof(struct AcBodyType));
         for (Ib=0;Ib<AC->Nb;Ib++) {
            AC->B[Ib].mass = S->B[Ib].mass;
            for(i=0;i<3;i++) {
               AC->B[Ib].cm[i] = S->B[Ib].cm[i];
               for(j=0;j<3;j++) {
                  AC->B[Ib].MOI[i][j] = S->B[Ib].I[i][j];
               }
            }
         }
      }
      
      /* Joints */
      AC->Ng = S->Ng;
      if (AC->Ng > 0) {
         AC->G = (struct AcJointType *) calloc(AC->Ng,sizeof(struct AcJointType));
         for(Ig=0;Ig<AC->Ng;Ig++) {
            AC->G[Ig].IsSpherical = S->G[Ig].IsSpherical;
            AC->G[Ig].RotDOF = S->G[Ig].RotDOF;
            AC->G[Ig].TrnDOF = S->G[Ig].TrnDOF;
            for(i=0;i<3;i++) {
               for(j=0;j<3;j++) {
                  AC->G[Ig].CGiBi[i][j] = S->G[Ig].CGiBi[i][j];
                  AC->G[Ig].CBoGo[i][j] = S->G[Ig].CBoGo[i][j];
               }
            }
            AC->G[Ig].RotSeq = S->G[Ig].RotSeq;
            AC->G[Ig].TrnSeq = S->G[Ig].TrnSeq;
         }
      }
      
      /* Gyro Axes */
      AC->Ngyro = S->Ngyro;
      if (AC->Ngyro > 0) {
         AC->Gyro = (struct AcGyroType *) calloc(AC->Ngyro,sizeof(struct AcGyroType));
         for(i=0;i<S->Ngyro;i++) {
            for(j=0;j<3;j++) {
               AC->Gyro[i].Axis[j] = S->Gyro[i].Axis[j];
            }
         }
      }

      /* Magnetometer Axes */
      AC->Nmag = S->Nmag;
      if (AC->Nmag > 0) {
         AC->MAG = (struct AcMagnetometerType *) calloc(AC->Nmag,sizeof(struct AcMagnetometerType));
         for(i=0;i<S->Nmag;i++) {
            for(j=0;j<3;j++) {
               AC->MAG[i].Axis[j] = S->MAG[i].Axis[j];
            }
         }
      }

      /* Coarse Sun Sensors */
      AC->Ncss = S->Ncss;
      if (AC->Ncss > 0) {
         AC->CSS = (struct AcCssType *) calloc(AC->Ncss,sizeof(struct AcCssType));
         for(i=0;i<S->Ncss;i++) {
            AC->CSS[i].Body = S->CSS[i].Body;
            for(j=0;j<3;j++) AC->CSS[i].Axis[j] = S->CSS[i].Axis[j];
            AC->CSS[i].Scale = S->CSS[i].Scale;
         }
      }
      
      /* Fine Sun Sensors */
      AC->Nfss = S->Nfss;
      if (AC->Nfss > 0) {
         AC->FSS = (struct AcFssType *) calloc(AC->Nfss,sizeof(struct AcFssType));
         for(k=0;k<S->Nfss;k++) {
            for(i=0;i<3;i++) {
               for(j=0;j<3;j++) AC->FSS[k].CB[i][j] = S->FSS[k].CB[i][j];
            }
            for(i=0;i<4;i++) AC->FSS[k].qb[i] = S->FSS[k].qb[i];
         }
      }

      /* Star Trackers */
      AC->Nst = S->Nst;
      if (AC->Nst > 0) {
         AC->ST = (struct AcStarTrackerType *) calloc(AC->Nst,sizeof(struct AcStarTrackerType));
         for(k=0;k<S->Nst;k++) {
            for(i=0;i<3;i++) {
               for(j=0;j<3;j++) AC->ST[k].CB[i][j] = S->ST[k].CB[i][j];
            }
            for(i=0;i<4;i++) AC->ST[k].qb[i] = S->ST[k].qb[i];
         }
      }

      /* GPS */
      AC->Ngps = S->Ngps;
      if (AC->Ngps > 0) {
         AC->GPS = (struct AcGpsType *) calloc(AC->Ngps,sizeof(struct AcGpsType)); 
      }     
      
      /* Accelerometer Axes */
      AC->Nacc = S->Nacc;
      if (AC->Nacc > 0) {
         AC->Accel = (struct AcAccelType *) calloc(AC->Nacc,sizeof(struct AcAccelType));
         for(i=0;i<S->Nacc;i++) {
            for(j=0;j<3;j++) {
               AC->Accel[i].Axis[j] = S->Accel[i].Axis[j];
            }
         }
      }

      /* Wheels */
      AC->Nwhl = S->Nw;
      if (AC->Nwhl > 0) {
         AC->Whl = (struct AcWhlType *) calloc(AC->Nwhl,sizeof(struct AcWhlType));
         A = CreateMatrix(3,AC->Nwhl);
         Aplus = CreateMatrix(AC->Nwhl,3);
         for (i=0;i<S->Nw;i++) {
            AC->Whl[i].Body = S->Whl[i].Body;
            for (j=0;j<3;j++) {
               AC->Whl[i].Axis[j] = S->Whl[i].A[j];
               A[j][i] = S->Whl[i].A[j];
            }
         }
         if (S->Nw == 1) {
            for(i=0;i<3;i++) AC->Whl[0].DistVec[i] = AC->Whl[0].Axis[i]; 
         }
         else if (S->Nw >= 2) {
            PINVG(A,Aplus,3,S->Nw);
            for(i=0;i<AC->Nwhl;i++) {
               for(j=0;j<3;j++) {
                  AC->Whl[i].DistVec[j] = Aplus[i][j];
               }
            }
         }
         DestroyMatrix(A,3);
         DestroyMatrix(Aplus,AC->Nwhl);
         for(i=0;i<S->Nw;i++) {
            AC->Whl[i].J = S->Whl[i].J;
            AC->Whl[i].Tmax = S->Whl[i].Tmax;
            AC->Whl[i].Hmax = S->Whl[i].Hmax;
         }
      }

      /* Magnetic Torquer Bars */
      AC->Nmtb = S->Nmtb;
      if (AC->Nmtb > 0) {
         AC->MTB = (struct AcMtbType *) calloc(AC->Nmtb,sizeof(struct AcMtbType));
         A = CreateMatrix(3,AC->Nmtb);
         Aplus = CreateMatrix(AC->Nmtb,3);
         for (i=0;i<S->Nmtb;i++) {
            for (j=0;j<3;j++) {
               AC->MTB[i].Axis[j] = S->MTB[i].A[j];
               A[j][i] = S->MTB[i].A[j];
            }
         }
         if (S->Nmtb == 1) {
            for(i=0;i<3;i++) AC->MTB[0].DistVec[i] = AC->MTB[0].Axis[i]; 
         }
         else if (S->Nmtb >= 2) {
            PINVG(A,Aplus,3,S->Nmtb);
            for(i=0;i<AC->Nmtb;i++) {
               for(j=0;j<3;j++) {
                  AC->MTB[i].DistVec[j] = Aplus[i][j];
               }
            }
         }
         DestroyMatrix(A,3);
         DestroyMatrix(Aplus,AC->Nmtb);
         for(i=0;i<S->Nmtb;i++) {
            AC->MTB[i].Mmax = S->MTB[i].Mmax;
         }
      }

      /* Thrusters */
      AC->Nthr = S->Nthr;
      if (AC->Nthr > 0) {
         AC->Thr = (struct AcThrType *) calloc(AC->Nthr,sizeof(struct AcThrType));
         for(i=0;i<S->Nthr;i++) {
            AC->Thr[i].Body = S->Thr[i].Body;
            AC->Thr[i].Fmax = S->Thr[i].Fmax;
            for(j=0;j<3;j++) {
               AC->Thr[i].Axis[j] = S->Thr[i].A[j];
               AC->Thr[i].PosB[j] = S->B[S->Thr[i].Body].Node[S->Thr[i].Node].PosB[j];
               r[j] = AC->Thr[i].PosB[j] - AC->cm[j];
            }
            VxV(r,AC->Thr[i].Axis,AC->Thr[i].rxA);
         }
      }
      
      /* Controllers */
      AC->InstantCtrl.Init = 1;
      AC->SandboxCtrl.Init = 1;
      AC->SpinnerCtrl.Init = 1;
      AC->MomBiasCtrl.Init = 1;
      AC->ThreeAxisCtrl.Init = 1;
      AC->IssCtrl.Init = 1;
      AC->CmgCtrl.Init = 1;
      AC->ThrCtrl.Init = 1;
      AC->CfsCtrl.Init = 1;
      AC->ThrSteerCtrl.Init = 1;
      
      AC->InstantCtrl.wc = 0.05*TwoPi;
      AC->InstantCtrl.amax = 0.01;
      AC->InstantCtrl.vmax = 0.5*D2R;
      
      /* Initialize variables to avoid divide-by-zero before first sensor measurements */
      AC->qbn[3] = 1.0;
      AC->svb[0] = 1.0;
      AC->bvb[0] = 1.0E-4;
      
}
/**********************************************************************/
void MapCmdsToActuators(struct SCType *S)
{
      struct IdealActType *I;
      struct WhlType *W;
      struct MTBType *M;
      struct ThrType *T;
      struct AcType *AC;
      long i,Iw,Im,It;

      AC = &S->AC;
      
      if (S->GainAndDelayActive) {
         for(i=0;i<3;i++) {
            I = &S->IdealAct[i];
            I->Fcmd = Delay(I->FrcDelay,S->LoopGain*AC->IdealFrc[i]);
            I->Tcmd = Delay(I->TrqDelay,S->LoopGain*AC->IdealTrq[i]);
         }
            
         for(Iw=0;Iw<AC->Nwhl;Iw++) {
            W = &S->Whl[Iw];
            W->Tcmd = Delay(W->Delay,S->LoopGain*AC->Whl[Iw].Tcmd);
         }
         for(Im=0;Im<AC->Nmtb;Im++) {
            M = &S->MTB[Im];
            M->Mcmd = Delay(M->Delay,S->LoopGain*AC->MTB[Im].Mcmd);
         }
         for(It=0;It<AC->Nthr;It++) {
            T = &S->Thr[It];
            if (T->Mode == THR_PULSED) 
               T->PulseWidthCmd = Delay(T->Delay,S->LoopGain*AC->Thr[It].PulseWidthCmd);
            else
               T->ThrustLevelCmd = Delay(T->Delay,S->LoopGain*AC->Thr[It].ThrustLevelCmd);
         }         
      }
      else if (S->FswSampleCounter == 0) {      
         for(i=0;i<3;i++) {
            S->IdealAct[i].Fcmd = AC->IdealFrc[i];
            S->IdealAct[i].Tcmd = AC->IdealTrq[i];
         }
      
         for(Iw=0;Iw<AC->Nwhl;Iw++) {
            S->Whl[Iw].Tcmd = AC->Whl[Iw].Tcmd;
         }
         for(Im=0;Im<AC->Nmtb;Im++) {
            S->MTB[Im].Mcmd = AC->MTB[Im].Mcmd;
         }
         for(It=0;It<AC->Nthr;It++) {
            if (S->Thr[It].Mode == THR_PULSED) 
               S->Thr[It].PulseWidthCmd = AC->Thr[It].PulseWidthCmd;
            else
               S->Thr[It].ThrustLevelCmd = AC->Thr[It].ThrustLevelCmd;            
         }
      } 
              
}
/**********************************************************************/
void CfsFSW(struct AcType *AC)
{
      AcFsw(AC);
}
/**********************************************************************/
void FlightSoftWare(struct SCType *S)
{
      S->FswSampleCounter++;
      if (S->FswSampleCounter >= S->FswMaxCounter) {
         S->FswSampleCounter = 0;

         if (S->FswTag == CFS_FSW) {
            CfsFSW(&S->AC);
         }
      }

      MapCmdsToActuators(S);
}
