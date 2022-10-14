// circuit specific indicators: modular-motion-head 2021-08-26 

// these are... pin macros, generic

#define PIN_BM(pin) (uint32_t)(1 << pin)
#define PIN_HI(port, pin) PORT->Group[port].OUTSET.reg = PIN_BM(pin) 
#define PIN_LO(port, pin) PORT->Group[port].OUTCLR.reg = PIN_BM(pin) 
#define PIN_TGL(port, pin) PORT->Group[port].OUTTGL.reg = PIN_BM(pin)
#define PIN_SETUP_OUTPUT(port, pin) PORT->Group[port].DIRSET.reg = PIN_BM(pin) 

// these are clk and errlight from the moduul 

#define CLKLIGHT_ON PIN_LO(0, 27) 
#define CLKLIGHT_OFF PIN_HI(0, 27)
#define CLKLIGHT_TOGGLE PIN_TGL(0, 27)
#define CLKLIGHT_SETUP PIN_SETUP_OUTPUT(0, 27); CLKLIGHT_OFF

#define ERRLIGHT_ON PIN_LO(1, 8)
#define ERRLIGHT_OFF PIN_HI(1, 8)
#define ERRLIGHT_TOGGLE PIN_TGL(1, 8)
#define ERRLIGHT_SETUP PIN_SETUP_OUTPUT(1, 8); ERRLIGHT_OFF

#define DEBUG1PIN_ON PIN_LO(1, 7)
#define DEBUG1PIN_OFF PIN_HI(1, 7)
#define DEBUG1PIN_HI PIN_HI(1, 7)
#define DEBUG1PIN_LO PIN_LO(1, 7)
#define DEBUG1PIN_TOGGLE PIN_TGL(1, 7)
#define DEBUG1PIN_SETUP PIN_SETUP_OUTPUT(1, 7); PIN_LO(1, 7)

#define DEBUG2PIN_ON PIN_LO(1, 6)
#define DEBUG2PIN_OFF PIN_HI(1, 6)
#define DEBUG2PIN_HI PIN_HI(1, 6)
#define DEBUG2PIN_LO PIN_LO(1, 6)
#define DEBUG2PIN_TOGGLE PIN_TGL(1, 6)
#define DEBUG2PIN_SETUP PIN_SETUP_OUTPUT(1, 6); PIN_LO(1, 6)

#define DEBUG3PIN_ON PIN_LO(0, 3)
#define DEBUG3PIN_OFF PIN_HI(0, 3)
#define DEBUG3PIN_HI PIN_HI(0, 3)
#define DEBUG3PIN_LO PIN_LO(0, 3)
#define DEBUG3PIN_TOGGLE PIN_TGL(0, 3)
#define DEBUG3PIN_SETUP PIN_SETUP_OUTPUT(0, 3); PIN_LO(0, 3)

#define DEBUG4PIN_ON PIN_LO(1, 11)
#define DEBUG4PIN_OFF PIN_HI(1, 11)
#define DEBUG4PIN_HI PIN_HI(1, 11)
#define DEBUG4PIN_LO PIN_LO(1, 11)
#define DEBUG4PIN_TOGGLE PIN_TGL(1, 11)
#define DEBUG4PIN_SETUP PIN_SETUP_OUTPUT(1, 11); PIN_LO(1, 11)