// indicators for the macrofab-d 
#define CLKLIGHT_PIN 27
#define CLKLIGHT_PORT PORT->Group[0]
#define ERRLIGHT_PIN 8
#define ERRLIGHT_PORT PORT->Group[1]

// PB05, is DIP1 
#define DEBUG1PIN_PIN 5
#define DEBUG1PIN_PORT PORT->Group[1]
// PA23, is limit 
//#define DEBUG1PIN_PIN 23 
//#define DEBUG1PIN_PORT PORT->Group[0]
// PB04, is DIP2 
#define DEBUG2PIN_PIN 4
#define DEBUG2PIN_PORT PORT->Group[1]
// NOT setup 
#define DEBUG3PIN_PIN 13 
#define DEBUG3PIN_PORT PORT->Group[1]
#define DEBUG4PIN_PIN 14
#define DEBUG4PIN_PORT PORT->Group[1]

// PA27
#define CLKLIGHT_BM (uint32_t)(1 << CLKLIGHT_PIN)
#define CLKLIGHT_ON CLKLIGHT_PORT.OUTCLR.reg = CLKLIGHT_BM
#define CLKLIGHT_OFF CLKLIGHT_PORT.OUTSET.reg = CLKLIGHT_BM
#define CLKLIGHT_TOGGLE CLKLIGHT_PORT.OUTTGL.reg = CLKLIGHT_BM
#define CLKLIGHT_SETUP CLKLIGHT_PORT.DIRSET.reg = CLKLIGHT_BM; CLKLIGHT_OFF

// PB08 
#define ERRLIGHT_BM (uint32_t)(1 << ERRLIGHT_PIN)
#define ERRLIGHT_ON ERRLIGHT_PORT.OUTCLR.reg = ERRLIGHT_BM
#define ERRLIGHT_OFF ERRLIGHT_PORT.OUTSET.reg = ERRLIGHT_BM
#define ERRLIGHT_TOGGLE ERRLIGHT_PORT.OUTTGL.reg = ERRLIGHT_BM
#define ERRLIGHT_SETUP ERRLIGHT_PORT.DIRSET.reg = ERRLIGHT_BM; ERRLIGHT_OFF

// the limit: turn off as input if using as output 
#define DEBUG1PIN_BM (uint32_t)(1 << DEBUG1PIN_PIN)
#define DEBUG1PIN_ON DEBUG1PIN_PORT.OUTSET.reg = DEBUG1PIN_BM
#define DEBUG1PIN_OFF DEBUG1PIN_PORT.OUTCLR.reg = DEBUG1PIN_BM
#define DEBUG1PIN_TOGGLE DEBUG1PIN_PORT.OUTTGL.reg = DEBUG1PIN_BM
#define DEBUG1PIN_SETUP DEBUG1PIN_PORT.DIRSET.reg = DEBUG1PIN_BM; DEBUG1PIN_OFF

#define DEBUG2PIN_BM (uint32_t)(1 << DEBUG2PIN_PIN)
#define DEBUG2PIN_ON DEBUG2PIN_PORT.OUTSET.reg = DEBUG2PIN_BM
#define DEBUG2PIN_OFF DEBUG2PIN_PORT.OUTCLR.reg = DEBUG2PIN_BM
#define DEBUG2PIN_TOGGLE DEBUG2PIN_PORT.OUTTGL.reg = DEBUG2PIN_BM
#define DEBUG2PIN_SETUP DEBUG2PIN_PORT.DIRSET.reg = DEBUG2PIN_BM; DEBUG2PIN_OFF

#define DEBUG3PIN_BM (uint32_t)(1 << DEBUG3PIN_PIN)
#define DEBUG3PIN_ON DEBUG3PIN_PORT.OUTSET.reg = DEBUG3PIN_BM
#define DEBUG3PIN_OFF DEBUG3PIN_PORT.OUTCLR.reg = DEBUG3PIN_BM
#define DEBUG3PIN_TOGGLE DEBUG3PIN_PORT.OUTTGL.reg = DEBUG3PIN_BM
#define DEBUG3PIN_SETUP DEBUG3PIN_PORT.DIRSET.reg = DEBUG3PIN_BM; DEBUG3PIN_OFF

#define DEBUG4PIN_BM (uint32_t)(1 << DEBUG4PIN_PIN)
#define DEBUG4PIN_ON DEBUG4PIN_PORT.OUTSET.reg = DEBUG4PIN_BM
#define DEBUG4PIN_OFF DEBUG4PIN_PORT.OUTCLR.reg = DEBUG4PIN_BM
#define DEBUG4PIN_TOGGLE DEBUG4PIN_PORT.OUTTGL.reg = DEBUG4PIN_BM
#define DEBUG4PIN_SETUP DEBUG4PIN_PORT.DIRSET.reg = DEBUG4PIN_BM; DEBUG4PIN_OFF