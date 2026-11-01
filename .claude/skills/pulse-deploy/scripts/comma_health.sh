cd /data/openpilot
echo "up=$(cut -d. -f1 /proc/uptime)s"
PYTHONPATH=/data/openpilot timeout 15 /usr/local/venv/bin/python - <<PY
import openpilot.cereal.messaging as m, time
s=m.SubMaster(["deviceState","carState","selfdriveState","managerState"]);t=time.monotonic()
while time.monotonic()-t<4: s.update(100)
print("alive",all(s.alive[k] for k in("deviceState","managerState")),"started",s["deviceState"].started,"gear",s["carState"].gearShifter,"vEgo",round(s["carState"].vEgo,2))
ss=s["selfdriveState"]; print("car-alive",s.alive["carState"],"enabled",ss.enabled,"engageable",ss.engageable,"alert",ss.alertText1,"|",ss.alertText2)
ps=s["managerState"].processes
print("running",sum(p.running for p in ps),"of",len(ps))
want={"webhud","controlsd","selfdrived","card","pandad","modeld","ui","plannerd","radard"}
print({p.name:(p.running,p.exitCode) for p in ps if p.name in want})
print("crashed",[(p.name,p.exitCode) for p in ps if p.shouldBeRunning and not p.running])
PY
